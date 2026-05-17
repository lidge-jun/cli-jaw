import fs from 'fs';
import Database from 'better-sqlite3';
import { join, relative } from 'path';
import { instanceId } from '../core/instance.js';
import {
    type SearchHit,
    type ParsedMarkdown,
    getAdvancedMemoryDir,
    getAdvancedIndexDbPath,
    ensureDir,
    safeReadFile,
    hashText,
    listMarkdownFiles,
} from './shared.js';
import { expandSynonyms, initSynonymsTable } from './synonyms.js';

function parseMarkdownFile(raw: string): ParsedMarkdown {
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    if (lines[0] !== '---') {
        return { meta: {}, body: raw, bodyStartLine: 1 };
    }
    const closing = lines.findIndex((line, idx) => idx > 0 && line === '---');
    if (closing === -1) {
        return { meta: {}, body: raw, bodyStartLine: 1 };
    }
    const meta: Record<string, string> = {};
    for (const line of lines.slice(1, closing)) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (key) meta[key] = value;
    }
    return {
        meta,
        body: lines.slice(closing + 1).join('\n'),
        bodyStartLine: closing + 2,
    };
}

function buildHeaderPath(stack: string[]) {
    return stack.filter(Boolean).join(' > ');
}

function chunkMarkdown(absPath: string, relpath: string, kind: string) {
    const raw = safeReadFile(absPath);
    const parsed = parseMarkdownFile(raw);
    const lines = parsed.body.split('\n');
    const chunks: Array<{
        relpath: string;
        path: string;
        kind: string;
        source_start_line: number;
        source_end_line: number;
        source_hash: string;
        content: string;
    }> = [];

    const headings: string[] = [];
    let currentStart = parsed.bodyStartLine;
    let currentBody: string[] = [];
    let currentHeader = '';

    const flush = (endLine: number) => {
        const body = currentBody.join('\n').trim();
        if (!body) return;
        const headerPath = buildHeaderPath(headings);
        const prefix = [
            `Source: ${relpath}`,
            `Kind: ${kind}`,
            headerPath ? `Header: ${headerPath}` : '',
        ].filter(Boolean).join('\n');
        const content = `${prefix}\n\n${body}`.trim();
        chunks.push({
            relpath,
            path: absPath,
            kind,
            source_start_line: currentStart,
            source_end_line: endLine,
            source_hash: hashText(`${relpath}:${currentStart}:${body}`),
            content,
        });
    };

    for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx] ?? '';
        const actualLine = parsed.bodyStartLine + idx;
        const headerMatch = /^(#{1,3})\s+(.+)$/.exec(line.trim());
        if (headerMatch) {
            flush(actualLine - 1);
            const level = headerMatch[1]?.length || 1;
            headings[level - 1] = headerMatch[2]?.trim() || '';
            headings.length = level;
            currentHeader = headerMatch[2]?.trim() || '';
            currentStart = actualLine;
            currentBody = [line];
            continue;
        }
        if (!currentBody.length) {
            currentStart = actualLine;
            currentBody = currentHeader ? [currentHeader, line] : [line];
        } else {
            currentBody.push(line);
        }
    }
    flush(parsed.bodyStartLine + lines.length - 1);

    if (chunks.length === 0 && parsed.body.trim()) {
        chunks.push({
            relpath,
            path: absPath,
            kind,
            source_start_line: parsed.bodyStartLine,
            source_end_line: parsed.bodyStartLine + lines.length - 1,
            source_hash: hashText(`${relpath}:${parsed.body}`),
            content: parsed.body.trim(),
        });
    }
    return chunks;
}

export function getIndexDb() {
    ensureDir(getAdvancedMemoryDir());
    const db = new Database(getAdvancedIndexDbPath());
    try {
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 3000');
        db.exec(`
            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL,
                relpath TEXT NOT NULL,
                kind TEXT NOT NULL,
                home_id TEXT NOT NULL DEFAULT '',
                source_start_line INTEGER NOT NULL,
                source_end_line INTEGER NOT NULL,
                source_hash TEXT NOT NULL,
                content TEXT NOT NULL,
                content_hash TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_chunks_relpath ON chunks(relpath);
            CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                content,
                relpath UNINDEXED,
                kind UNINDEXED,
                tokenize = 'unicode61'
            );
        `);
        ensureTrigramIndex(db);
        initSynonymsTable(db);
        return db;
    } catch (err) {
        db.close();
        throw err;
    }
}

export function ensureTrigramIndex(db: Database.Database): void {
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_trigram USING fts5(
            chunk_id UNINDEXED,
            relpath UNINDEXED,
            body,
            tokenize = 'trigram'
        );
    `);
}

interface ChunkRow {
    path: string;
    relpath: string;
    kind: string;
    source_start_line: number;
    source_end_line: number;
    content: string;
    score?: number;
}

function clearIndex(db: Database.Database) {
    db.exec('DELETE FROM chunks;');
    db.exec(`DELETE FROM chunks_fts;`);
    db.exec('DELETE FROM chunks_trigram;');
}

export function indexedFiles(root: string) {
    const buckets = [
        join(root, 'profile.md'),
        ...listMarkdownFiles(join(root, 'shared')),
        ...listMarkdownFiles(join(root, 'episodes')),
        ...listMarkdownFiles(join(root, 'semantic')),
        ...listMarkdownFiles(join(root, 'procedures')),
    ];
    return buckets.filter((value, idx, arr) => value && arr.indexOf(value) === idx && fs.existsSync(value));
}

function kindForFile(root: string, file: string) {
    const rel = relative(root, file).replace(/\\/g, '/');
    if (rel === 'profile.md') return 'profile';
    if (rel.startsWith('shared/')) return 'shared';
    if (rel.startsWith('episodes/digests/')) return 'episode-cold';
    if (rel.startsWith('episodes/')) return 'episode';
    if (rel.startsWith('semantic/')) return 'semantic';
    if (rel.startsWith('procedures/')) return 'procedure';
    return 'memory';
}

export function reindexAll(root: string) {
    const db = getIndexDb();
    try {
        clearIndex(db);
        const now = new Date().toISOString();
        const homeId = instanceId();
        const insertChunk = db.prepare(`
            INSERT INTO chunks (path, relpath, kind, home_id, source_start_line, source_end_line, source_hash, content, content_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertFts = db.prepare('INSERT INTO chunks_fts (rowid, content, relpath, kind) VALUES (?, ?, ?, ?)');
        const insertTrigram = db.prepare('INSERT INTO chunks_trigram (chunk_id, relpath, body) VALUES (?, ?, ?)');
        let totalFiles = 0;
        let totalChunks = 0;
        const tx = db.transaction(() => {
            for (const file of indexedFiles(root)) {
                totalFiles += 1;
                const rel = relative(root, file).replace(/\\/g, '/');
                const kind = kindForFile(root, file);
                for (const chunk of chunkMarkdown(file, rel, kind)) {
                    const contentHash = hashText(chunk.content);
                    const info = insertChunk.run(chunk.path, chunk.relpath, chunk.kind, homeId, chunk.source_start_line, chunk.source_end_line, chunk.source_hash, chunk.content, contentHash, now);
                    const chunkId = Number(info.lastInsertRowid);
                    insertFts.run(chunkId, chunk.content, chunk.relpath, chunk.kind);
                    insertTrigram.run(chunkId, chunk.relpath, chunk.content);
                    totalChunks += 1;
                }
            }
        });
        tx();
        return { totalFiles, totalChunks };
    } finally { db.close(); }
}

export function reindexSingleFile(root: string, file: string) {
    if (!fs.existsSync(file)) return 0;
    const db = getIndexDb();
    try {
        const rel = relative(root, file).replace(/\\/g, '/');
        const kind = kindForFile(root, file);
        const now = new Date().toISOString();
        const homeId = instanceId();
        db.prepare('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE relpath = ?)').run(rel);
        db.prepare('DELETE FROM chunks_trigram WHERE chunk_id IN (SELECT id FROM chunks WHERE relpath = ?)').run(rel);
        db.prepare('DELETE FROM chunks WHERE relpath = ?').run(rel);
        const insertChunk = db.prepare('INSERT INTO chunks (path, relpath, kind, home_id, source_start_line, source_end_line, source_hash, content, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        const insertFts = db.prepare('INSERT INTO chunks_fts (rowid, content, relpath, kind) VALUES (?, ?, ?, ?)');
        const insertTrigram = db.prepare('INSERT INTO chunks_trigram (chunk_id, relpath, body) VALUES (?, ?, ?)');
        let count = 0;
        const tx = db.transaction(() => {
            for (const chunk of chunkMarkdown(file, rel, kind)) {
                const contentHash = hashText(chunk.content);
                const info = insertChunk.run(chunk.path, chunk.relpath, chunk.kind, homeId, chunk.source_start_line, chunk.source_end_line, chunk.source_hash, chunk.content, contentHash, now);
                const chunkId = Number(info.lastInsertRowid);
                insertFts.run(chunkId, chunk.content, chunk.relpath, chunk.kind);
                insertTrigram.run(chunkId, chunk.relpath, chunk.content);
                count++;
            }
        });
        tx();
        return count;
    } finally { db.close(); }
}

export function reindexIntegratedMemoryFile(file: string) {
    const root = getAdvancedMemoryDir();
    if (!fs.existsSync(file)) return 0;
    if (!file.startsWith(root)) return 0;
    return reindexSingleFile(root, file);
}

function buildLikeTerm(term: string) {
    return `%${term.replace(/[%_]/g, (m) => `\\${m}`)}%`;
}

function tokenizeQuery(query: string) {
    const trimmed = String(query || '').trim();
    if (!trimmed) return [];
    const tokens = trimmed
        .split(/[\s,]+/)
        .map(t => t.trim())
        .filter(Boolean);
    return Array.from(new Set([trimmed, ...tokens])).slice(0, 8);
}

function tokenizeExpandedQuery(query: string, expanded?: string[]) {
    const raw = expanded?.length ? [query, ...expanded] : tokenizeQuery(query);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        const value = String(item || '').replace(/[;&|`$><]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);
        if (!value) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(value);
        if (out.length >= 16) break;
    }
    return out;
}

function kindPriority(kind: string): number {
    if (kind === 'profile') return -4.0;
    if (kind === 'shared') return -3.0;
    if (kind === 'procedure') return -2.5;
    if (kind === 'semantic') return -2.0;
    if (kind === 'episode') return 0;
    if (kind === 'episode-cold') return 0;
    return 0;
}

const HALF_LIFE_HOURS: Record<string, number> = {
    episode: 24 * 7,
    'episode-cold': 24 * 180,
    semantic: 24 * 30,
    shared: 24 * 90,
    procedure: Infinity,
    profile: Infinity,
};

function recencyBoost(kind: string, relpath: string): number {
    const halfLife = HALF_LIFE_HOURS[kind] ?? 24 * 7;
    if (halfLife === Infinity) return 0;
    const dateMatch = /(\d{4}-\d{2}-\d{2})/.exec(relpath);
    if (!dateMatch) return 0;
    const ageHours = (Date.now() - new Date(dateMatch[1]!).getTime()) / 3600000;
    if (ageHours < 0) return -1.5;
    const boost = -1.5 * Math.exp(-Math.LN2 * ageHours / halfLife);
    // Penalize stale episodes: beyond 2x half-life, push them down
    if (kind === 'episode' && ageHours > halfLife * 2) {
        return boost + Math.min(2.0, (ageHours - halfLife * 2) / (halfLife * 2));
    }
    return boost;
}

function computeFinalScore(hit: SearchHit, query: string): number {
    const q = query.toLowerCase();
    const snippet = hit.snippet.toLowerCase();
    const exactMatch = snippet.includes(q);
    const phraseMatch = snippet.includes(`header: ${q}`) || snippet.includes(`## ${q}`);
    const kw = kindPriority(hit.kind);
    const rw = recencyBoost(hit.kind, hit.relpath);
    const exactBoost = exactMatch ? -2.0 : 0;
    const phraseBoost = phraseMatch ? -1.0 : 0;
    return hit.score + kw + rw + exactBoost + phraseBoost;
}

export function formatHits(hits: SearchHit[], opts: { includeDebugMeta?: boolean } = {}) {
    if (!hits.length) return '(no results)';
    return hits.map(hit => {
        const loc = `${hit.relpath}:${hit.source_start_line}-${hit.source_end_line}`;
        const debug = opts.includeDebugMeta
            ? `\n[kind=${hit.kind} final=${hit.score.toFixed(1)}]`
            : '';
        return `${loc}${debug}\n${hit.snippet}`;
    }).join('\n\n---\n\n');
}

function quoteFtsTerm(term: string): string {
    const cleaned = String(term || '').replace(/"/g, '""').trim();
    return cleaned ? `"${cleaned}"` : '';
}

function toHit(row: ChunkRow, score: number): SearchHit {
    return {
        path: row.path,
        relpath: row.relpath,
        kind: row.kind,
        source_start_line: row.source_start_line,
        source_end_line: row.source_end_line,
        snippet: String(row.content || '').slice(0, 700),
        score,
    };
}

function searchBM25(db: Database.Database, groups: string[][]): SearchHit[] {
    const hits = new Map<string, SearchHit>();
    const fts = db.prepare(`
        SELECT
            c.path,
            c.relpath,
            c.kind,
            c.source_start_line,
            c.source_end_line,
            c.content,
            bm25(chunks_fts) AS score
        FROM chunks_fts
        JOIN chunks c ON c.id = chunks_fts.rowid
        WHERE chunks_fts MATCH ?
        ORDER BY score
        LIMIT 16
    `);
    const like = db.prepare(`
        SELECT path, relpath, kind, source_start_line, source_end_line, content
        FROM chunks
        WHERE content LIKE ? ESCAPE '\\'
        ORDER BY relpath ASC, source_start_line ASC
        LIMIT 16
    `);
    for (const group of groups) {
        const ftsQuery = group.map(quoteFtsTerm).filter(Boolean).join(' OR ');
        try {
            for (const row of fts.all(ftsQuery) as ChunkRow[]) {
                const key = `${row.relpath}:${row.source_start_line}:${row.source_end_line}`;
                if (!hits.has(key)) hits.set(key, toHit(row, Number(row.score || 0)));
            }
        } catch { /* fall through to LIKE */ }
        for (const term of group) {
            for (const row of like.all(buildLikeTerm(term)) as ChunkRow[]) {
                const key = `${row.relpath}:${row.source_start_line}:${row.source_end_line}`;
                if (!hits.has(key)) hits.set(key, toHit(row, 999));
            }
        }
    }
    return [...hits.values()];
}

function searchTrigram(db: Database.Database, query: string): SearchHit[] {
    const term = String(query || '').trim();
    if (term.length < 3) return [];
    try {
        const rows = db.prepare(`
            SELECT c.path, c.relpath, c.kind, c.source_start_line, c.source_end_line, c.content, 0 AS score
            FROM chunks_trigram t
            JOIN chunks c ON c.id = t.chunk_id
            WHERE chunks_trigram MATCH ?
            LIMIT 15
        `).all(quoteFtsTerm(term)) as ChunkRow[];
        return rows.map((row, idx) => toHit(row, idx));
    } catch { return []; }
}

function reciprocalRankFusion(primary: SearchHit[], secondary: SearchHit[], k = 60): SearchHit[] {
    const scores = new Map<string, { hit: SearchHit; score: number }>();
    for (const [listIndex, list] of [primary, secondary].entries()) {
        for (let i = 0; i < list.length; i++) {
            const hit = list[i]!;
            const key = `${hit.relpath}:${hit.source_start_line}:${hit.source_end_line}`;
            const prev = scores.get(key);
            scores.set(key, { hit: prev?.hit ?? hit, score: (prev?.score ?? 0) + (listIndex === 0 ? 1 : 0.8) / (k + i) });
        }
    }
    return [...scores.values()].sort((a, b) => b.score - a.score).map(v => ({ ...v.hit, score: -v.score }));
}

interface SchemaCapability {
    hasSynonyms: boolean;
    hasTrigram: boolean;
    chunksColumns: Set<string>;
}

function probeSchema(db: Database.Database): SchemaCapability {
    const tables = new Set<string>(
        (db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table')`).all() as Array<{ name: string }>)
            .map(r => r.name)
    );
    const cols = new Set<string>(
        (db.prepare(`PRAGMA table_info(chunks)`).all() as Array<{ name: string }>).map(r => r.name)
    );
    return { hasSynonyms: tables.has('memory_synonyms'), hasTrigram: tables.has('chunks_trigram'), chunksColumns: cols };
}

function searchIndexCore(
    db: Database.Database,
    query: string,
    expanded: string[] | undefined,
    cap: SchemaCapability,
): { hits: SearchHit[]; degraded: string[] } {
    const terms = tokenizeExpandedQuery(query, expanded);
    if (!terms.length) return { hits: [], degraded: [] };
    const degraded: string[] = [];
    const groups = cap.hasSynonyms
        ? terms.map(term => expandSynonyms(db, term))
        : (degraded.push('memory_synonyms'), terms.map(t => [t]));
    const bm25 = searchBM25(db, groups);
    const trigram = cap.hasTrigram ? searchTrigram(db, query) : (degraded.push('chunks_trigram'), [] as SearchHit[]);
    const merged = reciprocalRankFusion(bm25, trigram);
    const baseQuery = terms[0] || query;
    const hits = merged
        .map(hit => ({ ...hit, score: computeFinalScore(hit, baseQuery) }))
        .sort((a, b) => a.score - b.score)
        .slice(0, 8);
    return { hits, degraded };
}

export function searchIndex(query: string, expanded?: string[]): { hits: SearchHit[] } {
    const db = getIndexDb();
    try {
        const cap: SchemaCapability = { hasSynonyms: true, hasTrigram: true, chunksColumns: new Set() };
        return { hits: searchIndexCore(db, query, expanded, cap).hits };
    } finally { db.close(); }
}

export interface ReadOnlySearchResult { hits: SearchHit[]; degraded: string[]; }

export function searchIndexReadOnly(dbPath: string, query: string, expanded?: string[]): ReadOnlySearchResult {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 3000');
    try {
        const cap = probeSchema(db);
        if (!cap.chunksColumns.has('content') || !cap.chunksColumns.has('relpath')) {
            return { hits: [], degraded: ['chunks.core'] };
        }
        return searchIndexCore(db, query, expanded, cap);
    } finally { db.close(); }
}

export function reindexIndexCounts(dbPath: string) {
    const db = new Database(dbPath, { readonly: true });
    const totalChunks = Number((db.prepare('SELECT COUNT(*) AS c FROM chunks').get() as { c?: number } | undefined)?.c || 0);
    const totalFiles = Number((db.prepare('SELECT COUNT(DISTINCT relpath) AS c FROM chunks').get() as { c?: number } | undefined)?.c || 0);
    db.close();
    return { totalFiles, totalChunks };
}

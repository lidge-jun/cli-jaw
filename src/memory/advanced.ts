import fs from 'fs';
import os from 'os';
import Database from 'better-sqlite3';
import { join, relative, dirname } from 'path';
import { createHash } from 'crypto';
import { JAW_HOME, settings } from '../core/config.js';
import { instanceId } from '../core/instance.js';
import { getMemory } from '../core/db.js';

type BootstrapOptions = {
    importCore?: boolean;
    importMarkdown?: boolean;
    importKv?: boolean;
    importClaudeSession?: boolean;
};

type AdvancedMeta = {
    schemaVersion: number;
    phase: string;
    homeId: string;
    jawHome: string;
    initializedAt: string;
    bootstrapStatus?: 'idle' | 'running' | 'done' | 'failed';
    lastBootstrapAt?: string | null;
    lastError?: string;
    importedCounts?: {
        core: number;
        markdown: number;
        kv: number;
        claude: number;
    };
};

type SearchHit = {
    path: string;
    relpath: string;
    kind: string;
    source_start_line: number;
    source_end_line: number;
    snippet: string;
    score: number;
};

type ParsedMarkdown = {
    meta: Record<string, string>;
    body: string;
    bodyStartLine: number;
};

const DEFAULT_IMPORTED_COUNTS = { core: 0, markdown: 0, kv: 0, claude: 0 };

export function getAdvancedMemoryDir() {
    return join(JAW_HOME, 'memory-advanced');
}

export function getAdvancedMemoryBackupDir() {
    return join(JAW_HOME, 'backup-memory-v1');
}

function getAdvancedIndexDbPath() {
    return join(getAdvancedMemoryDir(), 'index.sqlite');
}

export function normalizeOpenAiCompatibleBaseUrl(raw: string) {
    const value = String(raw || '').trim();
    if (!value) return '';
    const trimmed = value.replace(/\/+$/, '');
    return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function ensureDir(path: string) {
    fs.mkdirSync(path, { recursive: true });
}

function safeReadFile(path: string) {
    try {
        return fs.readFileSync(path, 'utf8');
    } catch {
        return '';
    }
}

function writeText(path: string, content: string) {
    ensureDir(dirname(path));
    fs.writeFileSync(path, content);
}

function frontmatter(meta: Record<string, string>) {
    const lines = ['---'];
    for (const [k, v] of Object.entries(meta)) {
        lines.push(`${k}: ${v}`);
    }
    lines.push('---', '');
    return lines.join('\n');
}

function hashText(text: string) {
    return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

function slug(value: string) {
    return value
        .replace(/\\/g, '/')
        .replace(/[^a-zA-Z0-9._/-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function listMarkdownFiles(dir: string) {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) continue;
            const full = join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.md')) out.push(full);
        }
    };
    walk(dir);
    return out.sort();
}

function countMarkdownFiles(dir: string) {
    return listMarkdownFiles(dir).length;
}

function countFiles(dir: string) {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) continue;
            const full = join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else count++;
        }
    };
    walk(dir);
    return count;
}

function getMetaPath() {
    return join(getAdvancedMemoryDir(), 'meta.json');
}

function readMeta(): AdvancedMeta | null {
    const metaPath = getMetaPath();
    if (!fs.existsSync(metaPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as AdvancedMeta;
    } catch {
        return null;
    }
}

function writeMeta(patch: Partial<AdvancedMeta>) {
    const base: AdvancedMeta = readMeta() || {
        schemaVersion: 1,
        phase: '1',
        homeId: instanceId(),
        jawHome: JAW_HOME,
        initializedAt: new Date().toISOString(),
        bootstrapStatus: 'idle',
        importedCounts: { ...DEFAULT_IMPORTED_COUNTS },
    };
    const next: AdvancedMeta = {
        ...base,
        ...patch,
        importedCounts: {
            ...(base.importedCounts || DEFAULT_IMPORTED_COUNTS),
            ...(patch.importedCounts || {}),
        },
    };
    writeText(getMetaPath(), JSON.stringify(next, null, 2));
    return next;
}

function parseLegacyMemorySections(content: string) {
    const sections = {
        userPreferences: '',
        keyDecisions: '',
        activeProjects: '',
    };
    const patterns = [
        { key: 'userPreferences', re: /## User Preferences([\s\S]*?)(?=\n## |\s*$)/i },
        { key: 'keyDecisions', re: /## Key Decisions([\s\S]*?)(?=\n## |\s*$)/i },
        { key: 'activeProjects', re: /## Active Projects([\s\S]*?)(?=\n## |\s*$)/i },
    ] as const;
    for (const p of patterns) {
        const match = p.re.exec(content);
        if (match?.[1]) sections[p.key] = match[1].trim();
    }
    return sections;
}

function getLegacyClaudeMemoryDir() {
    const wd = (settings.workingDir || os.homedir()).replace(/^~/, os.homedir());
    const hash = wd.replace(/\//g, '-');
    return join(os.homedir(), '.claude', 'projects', hash, 'memory');
}

function importCoreMemory(root: string) {
    const corePath = join(JAW_HOME, 'memory', 'MEMORY.md');
    if (!fs.existsSync(corePath)) return 0;
    const content = safeReadFile(corePath);
    const parsed = parseLegacyMemorySections(content);
    const profilePath = join(root, 'profile.md');
    const body = `# Profile

## User Preferences
${parsed.userPreferences || ''}

## Key Decisions
${parsed.keyDecisions || ''}

## Active Projects
${parsed.activeProjects || ''}
`;
    const fm = frontmatter({
        id: `profile-${instanceId()}`,
        home_id: instanceId(),
        kind: 'profile',
        source: 'legacy-memory-md',
        trust_level: 'high',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    });
    writeText(profilePath, fm + body);
    return 1;
}

function importMarkdownMemory(root: string) {
    const legacyDir = join(JAW_HOME, 'memory');
    if (!fs.existsSync(legacyDir)) return 0;
    const files = listMarkdownFiles(legacyDir).filter(f => f !== join(legacyDir, 'MEMORY.md'));
    let imported = 0;
    for (const file of files) {
        const rel = relative(legacyDir, file).replace(/\\/g, '/');
        const body = safeReadFile(file);
        const sourceHash = hashText(body);
        const baseName = rel.split('/').pop() || 'memory.md';
        const isDated = /^\d{4}-\d{2}-\d{2}\.md$/.test(baseName);
        const sectionDir = isDated ? 'episodes/imported' : 'semantic/imported';
        const dest = join(root, sectionDir, rel);
        const fm = frontmatter({
            id: `import-${sourceHash}`,
            home_id: instanceId(),
            kind: isDated ? 'episode' : 'semantic',
            source: 'legacy-markdown',
            trust_level: 'high',
            source_relpath: rel,
            source_hash: sourceHash,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });
        writeText(dest, fm + body.trim() + '\n');
        imported += 1;
    }
    return imported;
}

function importKvMemory(root: string) {
    const rows = getMemory.all() as Array<{ key: string; value: string; source?: string }>;
    if (!rows.length) return 0;
    const lines = rows.map(r => `- \`${r.key}\`: ${r.value} ${r.source ? `(source: ${r.source})` : ''}`);
    const fm = frontmatter({
        id: `kv-${instanceId()}`,
        home_id: instanceId(),
        kind: 'semantic',
        source: 'legacy-kv-table',
        trust_level: 'high',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    });
    writeText(join(root, 'semantic', 'kv-imported.md'), fm + '# Imported KV Memory\n\n' + lines.join('\n') + '\n');
    return rows.length;
}

function importClaudeSessionMemory(root: string) {
    const claudeDir = getLegacyClaudeMemoryDir();
    if (!fs.existsSync(claudeDir)) return 0;
    const files = listMarkdownFiles(claudeDir);
    let imported = 0;
    for (const file of files) {
        const real = fs.realpathSync(file);
        const body = safeReadFile(file);
        const sourceHash = hashText(body);
        const base = slug(relative(claudeDir, real).replace(/\\/g, '/')) || slug(file.split('/').pop() || 'legacy');
        const dest = join(root, 'episodes', 'legacy', `${base}-${sourceHash}.md`);
        const fm = frontmatter({
            id: `claude-${sourceHash}`,
            home_id: instanceId(),
            kind: 'episode',
            source: 'external-claude-memory',
            trust_level: 'medium',
            source_realpath: real.replace(/\\/g, '/'),
            source_hash: sourceHash,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });
        writeText(dest, fm + body.trim() + '\n');
        imported += 1;
    }
    return imported;
}

function backupLegacyMemory() {
    const backupRoot = getAdvancedMemoryBackupDir();
    ensureDir(backupRoot);
    const legacyMemoryDir = join(JAW_HOME, 'memory');
    const backupMemoryDir = join(backupRoot, 'memory');
    if (fs.existsSync(legacyMemoryDir)) {
        fs.rmSync(backupMemoryDir, { recursive: true, force: true });
        fs.cpSync(legacyMemoryDir, backupMemoryDir, { recursive: true });
    }
    const kvRows = getMemory.all();
    writeText(join(backupRoot, 'memory-kv.json'), JSON.stringify(kvRows, null, 2));
    return backupRoot;
}

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

function getIndexDb() {
    ensureDir(getAdvancedMemoryDir());
    const db = new Database(getAdvancedIndexDbPath());
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL,
            relpath TEXT NOT NULL,
            kind TEXT NOT NULL,
            source_start_line INTEGER NOT NULL,
            source_end_line INTEGER NOT NULL,
            source_hash TEXT NOT NULL,
            content TEXT NOT NULL
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
    return db;
}

function clearIndex(db: any) {
    db.exec('DELETE FROM chunks;');
    db.exec(`DELETE FROM chunks_fts;`);
}

function indexedFiles(root: string) {
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
    if (rel.startsWith('episodes/')) return 'episode';
    if (rel.startsWith('semantic/')) return 'semantic';
    if (rel.startsWith('procedures/')) return 'procedure';
    return 'memory';
}

function reindexAll(root: string) {
    const db = getIndexDb();
    clearIndex(db);

    const insertChunk = db.prepare(`
        INSERT INTO chunks (path, relpath, kind, source_start_line, source_end_line, source_hash, content)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare(`
        INSERT INTO chunks_fts (rowid, content, relpath, kind)
        VALUES (?, ?, ?, ?)
    `);

    let totalFiles = 0;
    let totalChunks = 0;
    const tx = db.transaction(() => {
        for (const file of indexedFiles(root)) {
            totalFiles += 1;
            const rel = relative(root, file).replace(/\\/g, '/');
            const kind = kindForFile(root, file);
            for (const chunk of chunkMarkdown(file, rel, kind)) {
                const info = insertChunk.run(
                    chunk.path,
                    chunk.relpath,
                    chunk.kind,
                    chunk.source_start_line,
                    chunk.source_end_line,
                    chunk.source_hash,
                    chunk.content,
                );
                insertFts.run(
                    Number(info.lastInsertRowid),
                    chunk.content,
                    chunk.relpath,
                    chunk.kind,
                );
                totalChunks += 1;
            }
        }
    });
    tx();
    db.close();
    return { totalFiles, totalChunks };
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

function formatHits(hits: SearchHit[]) {
    if (!hits.length) return '(no results)';
    return hits.map(hit => {
        const loc = `${hit.relpath}:${hit.source_start_line}-${hit.source_end_line}`;
        return `${loc}\n${hit.snippet}`;
    }).join('\n\n---\n\n');
}

function searchIndex(query: string) {
    const db = getIndexDb();
    const searchTerms = tokenizeQuery(query);
    if (!searchTerms.length) {
        db.close();
        return { hits: [] as SearchHit[] };
    }

    const byPathLine = new Map<string, SearchHit>();
    const ftsStmt = db.prepare(`
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
    const likeStmt = db.prepare(`
        SELECT path, relpath, kind, source_start_line, source_end_line, content
        FROM chunks
        WHERE content LIKE ? ESCAPE '\\'
        ORDER BY relpath ASC, source_start_line ASC
        LIMIT 16
    `);

    for (const term of searchTerms) {
        const ftsQuery = term.split(/\s+/).map(t => `"${t.replace(/"/g, '')}"`).join(' OR ');
        try {
            const rows = ftsStmt.all(ftsQuery) as any[];
            for (const row of rows) {
                const key = `${row.relpath}:${row.source_start_line}:${row.source_end_line}`;
                if (!byPathLine.has(key)) {
                    byPathLine.set(key, {
                        path: row.path,
                        relpath: row.relpath,
                        kind: row.kind,
                        source_start_line: row.source_start_line,
                        source_end_line: row.source_end_line,
                        snippet: String(row.content || '').slice(0, 700),
                        score: Number(row.score || 0),
                    });
                }
            }
        } catch {
            // ignore FTS parse issues, fallback to LIKE below
        }
        const likeRows = likeStmt.all(buildLikeTerm(term)) as any[];
        for (const row of likeRows) {
            const key = `${row.relpath}:${row.source_start_line}:${row.source_end_line}`;
            if (!byPathLine.has(key)) {
                byPathLine.set(key, {
                    path: row.path,
                    relpath: row.relpath,
                    kind: row.kind,
                    source_start_line: row.source_start_line,
                    source_end_line: row.source_end_line,
                    snippet: String(row.content || '').slice(0, 700),
                    score: 999,
                });
            }
        }
    }
    db.close();
    const hits = [...byPathLine.values()]
        .sort((a, b) => a.score - b.score)
        .slice(0, 8);
    return { hits };
}

function updateImportedCount(kind: keyof NonNullable<AdvancedMeta['importedCounts']>, value: number) {
    const meta = readMeta();
    writeMeta({
        importedCounts: {
            ...(meta?.importedCounts || DEFAULT_IMPORTED_COUNTS),
            [kind]: value,
        },
    });
}

function isAdvancedShadowEnabled() {
    return settings.memoryAdvanced?.enabled === true && fs.existsSync(getMetaPath());
}

function importSingleMarkdownFile(root: string, file: string) {
    const legacyDir = join(JAW_HOME, 'memory');
    if (!file.startsWith(legacyDir)) return null;
    const rel = relative(legacyDir, file).replace(/\\/g, '/');
    if (!rel || rel === 'MEMORY.md') return null;
    const body = safeReadFile(file);
    const sourceHash = hashText(body);
    const baseName = rel.split('/').pop() || 'memory.md';
    const isDated = /^\d{4}-\d{2}-\d{2}\.md$/.test(baseName);
    const sectionDir = isDated ? 'episodes/imported' : 'semantic/imported';
    const dest = join(root, sectionDir, rel);
    const fm = frontmatter({
        id: `import-${sourceHash}`,
        home_id: instanceId(),
        kind: isDated ? 'episode' : 'semantic',
        source: 'legacy-markdown',
        trust_level: 'high',
        source_relpath: rel,
        source_hash: sourceHash,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    });
    writeText(dest, fm + body.trim() + '\n');
    reindexAdvancedMemory();
    return dest;
}

export function syncLegacyMarkdownShadowImport(file: string) {
    if (!isAdvancedShadowEnabled()) return { ok: false, reason: 'advanced_not_ready' };
    const root = getAdvancedMemoryDir();
    if (file === join(JAW_HOME, 'memory', 'MEMORY.md')) {
        const count = importCoreMemory(root);
        updateImportedCount('core', count);
        reindexAdvancedMemory();
        return { ok: true, target: join(root, 'profile.md'), count };
    }
    const target = importSingleMarkdownFile(root, file);
    if (!target) return { ok: false, reason: 'not_importable' };
    updateImportedCount('markdown', countMarkdownFiles(join(root, 'semantic')) + countMarkdownFiles(join(root, 'episodes')));
    return { ok: true, target, count: 1 };
}

export function syncKvShadowImport() {
    if (!isAdvancedShadowEnabled()) return { ok: false, reason: 'advanced_not_ready' };
    const root = getAdvancedMemoryDir();
    const count = importKvMemory(root);
    updateImportedCount('kv', count);
    reindexAdvancedMemory();
    return { ok: true, target: join(root, 'semantic', 'kv-imported.md'), count };
}

export function ensureAdvancedMemoryStructure() {
    const root = getAdvancedMemoryDir();
    const sharedDir = join(root, 'shared');
    const episodesDir = join(root, 'episodes');
    const semanticDir = join(root, 'semantic');
    const proceduresDir = join(root, 'procedures');
    const sessionsDir = join(root, 'sessions');
    const corruptedDir = join(root, 'corrupted');
    const unmappedDir = join(root, 'legacy-unmapped');
    ensureDir(root);
    ensureDir(sharedDir);
    ensureDir(episodesDir);
    ensureDir(semanticDir);
    ensureDir(proceduresDir);
    ensureDir(sessionsDir);
    ensureDir(corruptedDir);
    ensureDir(unmappedDir);

    writeMeta({
        schemaVersion: 1,
        phase: '1',
        homeId: instanceId(),
        jawHome: JAW_HOME,
        initializedAt: readMeta()?.initializedAt || new Date().toISOString(),
    });

    const profilePath = join(root, 'profile.md');
    if (!fs.existsSync(profilePath)) {
        const fm = frontmatter({
            id: `profile-${instanceId()}`,
            home_id: instanceId(),
            kind: 'profile',
            source: 'generated',
            trust_level: 'high',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });
        writeText(profilePath, fm + `# Profile

## User Preferences

## Key Decisions

## Active Projects
`);
    }

    return { root, metaPath: getMetaPath(), profilePath };
}

export function bootstrapAdvancedMemory(options: BootstrapOptions = {}) {
    const root = getAdvancedMemoryDir();
    ensureAdvancedMemoryStructure();
    writeMeta({
        bootstrapStatus: 'running',
        lastBootstrapAt: new Date().toISOString(),
        lastError: '',
    });

    const resolved = {
        importCore: options.importCore !== false,
        importMarkdown: options.importMarkdown !== false,
        importKv: options.importKv !== false,
        importClaudeSession: options.importClaudeSession !== false,
    };

    try {
        const backupRoot = backupLegacyMemory();
        const counts = {
            core: resolved.importCore ? importCoreMemory(root) : 0,
            markdown: resolved.importMarkdown ? importMarkdownMemory(root) : 0,
            kv: resolved.importKv ? importKvMemory(root) : 0,
            claude: resolved.importClaudeSession ? importClaudeSessionMemory(root) : 0,
        };
        const { totalFiles, totalChunks } = reindexAll(root);
        const meta = writeMeta({
            bootstrapStatus: 'done',
            importedCounts: counts,
            lastBootstrapAt: new Date().toISOString(),
            lastError: '',
        });
        return { root, backupRoot, counts, indexed: { totalFiles, totalChunks }, meta };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeMeta({
            bootstrapStatus: 'failed',
            lastBootstrapAt: new Date().toISOString(),
            lastError: message,
        });
        throw err;
    }
}

export function reindexAdvancedMemory() {
    const root = getAdvancedMemoryDir();
    ensureAdvancedMemoryStructure();
    return reindexAll(root);
}

export function listAdvancedMemoryFiles() {
    const root = getAdvancedMemoryDir();
    return {
        root,
        sections: {
            profile: fs.existsSync(join(root, 'profile.md')) ? ['profile.md'] : [],
            shared: listMarkdownFiles(join(root, 'shared')).map(f => relative(root, f).replace(/\\/g, '/')),
            episodes: listMarkdownFiles(join(root, 'episodes')).map(f => relative(root, f).replace(/\\/g, '/')),
            semantic: listMarkdownFiles(join(root, 'semantic')).map(f => relative(root, f).replace(/\\/g, '/')),
            procedures: listMarkdownFiles(join(root, 'procedures')).map(f => relative(root, f).replace(/\\/g, '/')),
            sessions: listMarkdownFiles(join(root, 'sessions')).map(f => relative(root, f).replace(/\\/g, '/')),
            corrupted: listMarkdownFiles(join(root, 'corrupted')).map(f => relative(root, f).replace(/\\/g, '/')),
            legacyUnmapped: listMarkdownFiles(join(root, 'legacy-unmapped')).map(f => relative(root, f).replace(/\\/g, '/')),
        },
    };
}

export function searchAdvancedMemory(query: string) {
    const { hits } = searchIndex(query);
    return formatHits(hits);
}

export function readAdvancedMemorySnippet(relPath: string, opts: { lines?: string } = {}) {
    const root = getAdvancedMemoryDir();
    const file = join(root, relPath);
    if (!fs.existsSync(file)) return null;
    const content = safeReadFile(file);
    if (opts.lines) {
        const parts = String(opts.lines).split('-').map(Number);
        const fromRaw = parts[0];
        const toRaw = parts[1];
        const from = Number.isFinite(fromRaw) && (fromRaw as number) > 0 ? (fromRaw as number) : 1;
        const to = Number.isFinite(toRaw) && (toRaw as number) >= from ? (toRaw as number) : from;
        return content.split('\n').slice(from - 1, to).join('\n');
    }
    return content;
}

export function getAdvancedMemoryStatus() {
    const root = getAdvancedMemoryDir();
    const meta = readMeta();
    const initialized = !!meta;
    const enabled = settings.memoryAdvanced?.enabled === true;
    const provider = settings.memoryAdvanced?.provider || 'gemini';
    const corruptedDir = join(root, 'corrupted');
    const dbPath = getAdvancedIndexDbPath();
    const indexReady = fs.existsSync(dbPath);
    const indexed = indexReady ? reindexIndexCounts(dbPath) : { totalFiles: 0, totalChunks: 0 };

    return {
        phase: meta?.phase || '0a',
        enabled,
        provider,
        state: !enabled ? 'disabled' : initialized ? 'configured' : 'not_initialized',
        initialized,
        storageRoot: root,
        routing: {
            searchRead: enabled && indexReady ? 'advanced' : 'basic',
            save: 'basic',
        },
        indexState: initialized ? (indexReady ? 'ready' : 'not_indexed') : 'not_initialized',
        indexedFiles: indexed.totalFiles,
        indexedChunks: indexed.totalChunks,
        lastIndexedAt: fs.existsSync(dbPath) ? fs.statSync(dbPath).mtime.toISOString() : null,
        importStatus: meta?.bootstrapStatus || (initialized ? 'idle' : 'not_started'),
        corruptedCount: countFiles(corruptedDir),
        lastExpansion: [],
        lastError: meta?.lastError || '',
        importedCounts: meta?.importedCounts || { ...DEFAULT_IMPORTED_COUNTS },
        backupRoot: getAdvancedMemoryBackupDir(),
    };
}

function reindexIndexCounts(dbPath: string) {
    const db = new Database(dbPath, { readonly: true });
    const totalChunks = Number((db.prepare('SELECT COUNT(*) AS c FROM chunks').get() as any)?.c || 0);
    const totalFiles = Number((db.prepare('SELECT COUNT(DISTINCT relpath) AS c FROM chunks').get() as any)?.c || 0);
    db.close();
    return { totalFiles, totalChunks };
}

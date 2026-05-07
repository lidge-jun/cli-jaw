import type Database from 'better-sqlite3';

const DEFAULT_SYNONYMS: Array<[string, string[]]> = [
    ['preference', ['preferences', '선호', '취향', '환경설정']],
    ['decision', ['decisions', '결정', '선택', '방침']],
    ['project', ['projects', '프로젝트', '작업']],
    ['runbook', ['runbooks', '절차', '런북', '매뉴얼']],
    ['workflow', ['워크플로우', '흐름', '절차']],
    ['pabcd', ['plan', 'audit', 'build', 'check', 'done']],
    ['fts', ['fts5', 'full-text-search']],
    ['bm25', ['ranking', 'relevance']],
    ['cli-jaw', ['cli_jaw', 'clijaw', 'jaw']],
    ['ima2', ['ima2-gen', 'image-gen', 'image_gen']],
];

function cleanTerm(value: string): string {
    return String(value || '').replace(/[;&|`$><]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);
}

export function initSynonymsTable(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS memory_synonyms (
            term TEXT NOT NULL,
            synonym TEXT NOT NULL,
            weight REAL NOT NULL DEFAULT 1.0,
            PRIMARY KEY (term, synonym)
        );
        CREATE INDEX IF NOT EXISTS idx_memory_synonyms_term ON memory_synonyms(term);
    `);
    const stmt = db.prepare('INSERT OR IGNORE INTO memory_synonyms (term, synonym) VALUES (?, ?)');
    for (const [term, synonyms] of DEFAULT_SYNONYMS) {
        const group = [term, ...synonyms];
        for (const left of group) {
            for (const right of group) {
                if (left.toLowerCase() !== right.toLowerCase()) stmt.run(left, right);
            }
        }
    }
}

export function expandSynonyms(db: Database.Database, term: string, limit = 8): string[] {
    const value = cleanTerm(term);
    if (!value) return [];
    const rows = db.prepare(`
        SELECT synonym FROM memory_synonyms
        WHERE term = ? COLLATE NOCASE
        ORDER BY weight DESC, synonym ASC
        LIMIT ?
    `).all(value, Math.max(0, limit - 1)) as Array<{ synonym?: string }>;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const candidate of [value, ...rows.map(row => cleanTerm(row.synonym || ''))]) {
        if (!candidate) continue;
        const key = candidate.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(candidate);
    }
    return out;
}

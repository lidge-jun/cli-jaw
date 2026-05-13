import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { searchFederated } from '../../src/manager/memory/federation.ts';
import type { InstanceMemoryRef } from '../../src/manager/memory/types.ts';

function freshTmp(): string {
    return mkdtempSync(join(tmpdir(), 'jaw-fed-'));
}

function createIndexDb(dbPath: string, opts: { withSynonyms?: boolean; withTrigram?: boolean } = {}): void {
    mkdirSync(join(dbPath, '..'), { recursive: true });
    const db = new Database(dbPath);
    try {
        db.pragma('journal_mode = WAL');
        db.exec(`
            CREATE TABLE chunks (
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
            CREATE VIRTUAL TABLE chunks_fts USING fts5(
                content, relpath UNINDEXED, kind UNINDEXED, tokenize='unicode61'
            );
        `);
        if (opts.withTrigram) {
            db.exec(`CREATE VIRTUAL TABLE chunks_trigram USING fts5(
                chunk_id UNINDEXED, relpath UNINDEXED, body, tokenize='trigram'
            );`);
        }
        if (opts.withSynonyms) {
            db.exec(`CREATE TABLE memory_synonyms (
                term TEXT NOT NULL,
                synonym TEXT NOT NULL,
                weight REAL NOT NULL DEFAULT 1.0
            );`);
        }
        const insertChunk = db.prepare(
            `INSERT INTO chunks (path, relpath, kind, source_start_line, source_end_line, source_hash, content) VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        const insertFts = db.prepare('INSERT INTO chunks_fts (rowid, content, relpath, kind) VALUES (?, ?, ?, ?)');
        const info = insertChunk.run(dbPath, 'shared/test.md', 'shared', 1, 2, 'h1', 'federation testing content');
        insertFts.run(Number(info.lastInsertRowid), 'federation testing content', 'shared/test.md', 'shared');
    } finally {
        db.close();
    }
}

function makeRef(id: string, homePath: string, hasDb = true): InstanceMemoryRef {
    return {
        instanceId: id,
        homePath,
        homeSource: 'default-port',
        port: Number(id),
        label: null,
        dbPath: join(homePath, 'memory', 'structured', 'index.sqlite'),
        hasDb,
    };
}

test('federation: returns hits from full-schema instances', () => {
    const base = freshTmp();
    const home = join(base, '.cli-jaw-3457');
    createIndexDb(join(home, 'memory', 'structured', 'index.sqlite'), { withSynonyms: true, withTrigram: true });
    const ref = makeRef('3457', home);
    const result = searchFederated('federation', { instances: [ref] });
    assert.equal(result.instancesQueried, 1);
    assert.equal(result.instancesSucceeded, 1);
    assert.equal(result.warnings.length, 0);
    assert.ok(result.hits.length > 0, 'should return at least one hit');
});

test('federation: hasDb=false → missing_db warning, still aggregates others', () => {
    const base = freshTmp();
    const home1 = join(base, '.cli-jaw-3457');
    createIndexDb(join(home1, 'memory', 'structured', 'index.sqlite'), { withSynonyms: true, withTrigram: true });
    const refOk = makeRef('3457', home1, true);
    const refMissing = makeRef('3458', join(base, '.cli-jaw-3458'), false);
    const result = searchFederated('federation', { instances: [refOk, refMissing] });
    assert.equal(result.instancesQueried, 2);
    assert.equal(result.instancesSucceeded, 1);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0]!.code, 'missing_db');
    assert.ok(result.hits.length > 0);
});

test('federation: older schema (no synonyms, no trigram) → schema_mismatch warning, BM25 hits return', () => {
    const base = freshTmp();
    const home = join(base, '.cli-jaw-3457');
    createIndexDb(join(home, 'memory', 'structured', 'index.sqlite'), { withSynonyms: false, withTrigram: false });
    const ref = makeRef('3457', home);
    const result = searchFederated('federation', { instances: [ref] });
    assert.equal(result.instancesSucceeded, 1);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0]!.code, 'schema_mismatch');
    assert.ok(result.warnings[0]!.detail?.degraded?.includes('memory_synonyms'));
    assert.ok(result.warnings[0]!.detail?.degraded?.includes('chunks_trigram'));
});

test('federation: empty query returns empty result with 0 queried', () => {
    const ref = makeRef('3457', '/tmp/never', true);
    const result = searchFederated('   ', { instances: [ref] });
    assert.equal(result.instancesQueried, 0);
    assert.equal(result.hits.length, 0);
});

test('federation: instanceFilter restricts to listed ids', () => {
    const base = freshTmp();
    const home1 = join(base, '.cli-jaw-3457');
    const home2 = join(base, '.cli-jaw-3458');
    createIndexDb(join(home1, 'memory', 'structured', 'index.sqlite'), { withSynonyms: true, withTrigram: true });
    createIndexDb(join(home2, 'memory', 'structured', 'index.sqlite'), { withSynonyms: true, withTrigram: true });
    const refs = [makeRef('3457', home1), makeRef('3458', home2)];
    const result = searchFederated('federation', { instances: refs, instanceFilter: ['3458'] });
    assert.equal(result.instancesQueried, 1);
});

test('federation: corrupt db produces structured warning, does not throw', () => {
    const base = freshTmp();
    const home = join(base, '.cli-jaw-3457');
    mkdirSync(join(home, 'memory', 'structured'), { recursive: true });
    writeFileSync(join(home, 'memory', 'structured', 'index.sqlite'), 'not a real sqlite db');
    const ref = makeRef('3457', home, true);
    const result = searchFederated('test', { instances: [ref] });
    assert.equal(result.instancesSucceeded, 0);
    assert.equal(result.warnings.length, 1);
    assert.ok(['corrupt', 'open_failed', 'query_failed'].includes(result.warnings[0]!.code));
});

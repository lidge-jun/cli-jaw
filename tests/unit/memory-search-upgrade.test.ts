import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getIndexDb, reindexAll, reindexSingleFile, searchIndex } from '../../src/memory/indexing.ts';

function makeMemoryRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'cli-jaw-memory-search-'));
}

function writeMemoryFile(root: string, relpath: string, content: string): string {
    const file = path.join(root, relpath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
}

test('MSU-001: synonym expansion finds Korean preference content from English query', () => {
    const root = makeMemoryRoot();
    writeMemoryFile(root, 'shared/preferences.md', '# Preferences\n\n- User has a strong 선호 for compact output.\n');
    reindexAll(root);
    const { hits } = searchIndex('preference');
    assert.ok(hits.some(hit => hit.relpath === 'shared/preferences.md'));
});

test('MSU-002: trigram side index is populated and supports Korean substring search', () => {
    const root = makeMemoryRoot();
    writeMemoryFile(root, 'episodes/live/2026-05-07.md', '# Day\n\n리플렉션 검색 개선을 논의했다.\n');
    reindexAll(root);
    const db = getIndexDb();
    const count = Number((db.prepare('SELECT COUNT(*) AS c FROM chunks_trigram').get() as { c?: number }).c || 0);
    db.close();
    assert.ok(count > 0);
    const { hits } = searchIndex('리플렉');
    assert.ok(hits.some(hit => hit.relpath === 'episodes/live/2026-05-07.md'));
});

test('MSU-003: reindexSingleFile updates trigram rows for changed files', () => {
    const root = makeMemoryRoot();
    const file = writeMemoryFile(root, 'episodes/live/2026-05-07.md', '# Day\n\noldsearchtoken only.\n');
    reindexAll(root);
    fs.writeFileSync(file, '# Day\n\nnewsearchtoken only.\n');
    assert.equal(reindexSingleFile(root, file), 1);
    const { hits: oldHits } = searchIndex('oldsearchtoken');
    const { hits: newHits } = searchIndex('newsearchtoken');
    assert.equal(oldHits.some(hit => hit.relpath === 'episodes/live/2026-05-07.md'), false);
    assert.equal(newHits.some(hit => hit.relpath === 'episodes/live/2026-05-07.md'), true);
});

test('MSU-004: profile and procedures retain stable priority over dated episodes', () => {
    const root = makeMemoryRoot();
    writeMemoryFile(root, 'profile.md', '# Profile\n\nstablepriority preference marker.\n');
    writeMemoryFile(root, 'procedures/runbooks.md', '# Runbook\n\nstablepriority run this command.\n');
    writeMemoryFile(root, 'episodes/live/2020-01-01.md', '# Old\n\nstablepriority old episode.\n');
    reindexAll(root);
    const { hits } = searchIndex('stablepriority');
    assert.equal(hits[0]?.relpath, 'profile.md');
    assert.ok(hits.some(hit => hit.relpath === 'procedures/runbooks.md'));
});

test('MSU-005: searchIndex preserves public return shape and eight-hit cap', () => {
    const root = makeMemoryRoot();
    for (let i = 0; i < 12; i++) {
        writeMemoryFile(root, `episodes/live/2026-05-${String(i + 1).padStart(2, '0')}.md`, `# Day\n\ncapmarker item ${i}.\n`);
    }
    reindexAll(root);
    const result = searchIndex('capmarker');
    assert.ok(Array.isArray(result.hits));
    assert.ok(result.hits.length <= 8);
});

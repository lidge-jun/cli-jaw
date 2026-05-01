import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('SESS-PRUNE-001: pruneSessions removes records older than the cutoff', async () => {
    const { createSession, pruneSessions, listSessions } = await import('../../src/browser/web-ai/session.ts');
    const before = createSession({
        vendor: 'chatgpt',
        targetId: `pruneA-${Date.now()}-${Math.random()}`,
        url: 'https://chatgpt.com/',
        envelope: { vendor: 'chatgpt', prompt: 'old', attachmentPolicy: 'inline-only' },
        assistantCount: 0,
        timeoutMs: 600_000,
    });
    // Cutoff in the near future means everything created before now is older.
    const cutoffIso = new Date(Date.now() + 5_000).toISOString();
    const result = pruneSessions({ before: cutoffIso });
    assert.ok(result.removed >= 1, `expected at least one removal (got ${result.removed})`);
    const left = listSessions({ vendor: 'chatgpt' });
    assert.equal(left.find(s => s.sessionId === before.sessionId), undefined);
});

test('SESS-PRUNE-002: pruneSessions returns no removals when olderThanMs cutoff is far in the past', async () => {
    const { createSession, pruneSessions } = await import('../../src/browser/web-ai/session.ts');
    createSession({
        vendor: 'chatgpt',
        targetId: `pruneB-${Date.now()}-${Math.random()}`,
        url: 'https://chatgpt.com/',
        envelope: { vendor: 'chatgpt', prompt: 'fresh', attachmentPolicy: 'inline-only' },
        assistantCount: 0,
        timeoutMs: 600_000,
    });
    // Cutoff = 1000 years ago — nothing should be older.
    const result = pruneSessions({ olderThanMs: 1000 * 365 * 86_400_000 });
    assert.equal(result.removed, 0);
});

test('SESS-PRUNE-003: pruneSessions respects a status filter', async () => {
    const { createSession, updateSessionStatus, pruneSessions, listSessions } = await import('../../src/browser/web-ai/session.ts');
    const a = createSession({
        vendor: 'chatgpt',
        targetId: `pruneC-${Date.now()}-${Math.random()}`,
        url: 'https://chatgpt.com/',
        envelope: { vendor: 'chatgpt', prompt: 'a-keep', attachmentPolicy: 'inline-only' },
        assistantCount: 0,
        timeoutMs: 600_000,
    });
    const b = createSession({
        vendor: 'chatgpt',
        targetId: `pruneD-${Date.now()}-${Math.random()}`,
        url: 'https://chatgpt.com/',
        envelope: { vendor: 'chatgpt', prompt: 'b-prune', attachmentPolicy: 'inline-only' },
        assistantCount: 0,
        timeoutMs: 600_000,
    });
    updateSessionStatus(b.sessionId, 'complete');
    const cutoffIso = new Date(Date.now() + 5_000).toISOString();
    const result = pruneSessions({ before: cutoffIso, status: 'complete' });
    assert.ok(result.removed >= 1, `expected to prune at least the complete session (got ${result.removed})`);
    const left = listSessions({ vendor: 'chatgpt' });
    assert.ok(left.some(s => s.sessionId === a.sessionId), 'sent (non-complete) session should remain');
    assert.equal(left.find(s => s.sessionId === b.sessionId), undefined, 'complete session should be pruned');
});

test('SESS-PRUNE-004: sessions-prune CLI command and HTTP route are wired', () => {
    const cli = readFileSync(join(process.cwd(), 'bin/commands/browser-web-ai.ts'), 'utf8');
    assert.match(cli, /'sessions-prune'/);
    assert.match(cli, /'POST', '\/web-ai\/sessions\/prune'/);
    const routes = readFileSync(join(process.cwd(), 'src/routes/browser.ts'), 'utf8');
    assert.match(routes, /\/api\/browser\/web-ai\/sessions\/prune/);
    assert.match(routes, /browser\.webAi\.sessionsPrune/);
});

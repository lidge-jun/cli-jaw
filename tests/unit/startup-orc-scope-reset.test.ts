import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getState, resetState, setState } from '../../src/orchestrator/state-machine.ts';
import { listActiveOrcStates } from '../../src/core/db.ts';

const serverSrc = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');

// ─── Source-shape tests (server.ts contract) ─────────

test('SOS-001: startup resets all active scoped orc_state rows', () => {
    assert.ok(serverSrc.includes('listActiveOrcStates'), 'server should enumerate active scoped states on startup');
    assert.ok(serverSrc.includes('resetState(row.id)'), 'server should reset each stale scope row');
});

test('SOS-002: snapshot endpoint includes scope', () => {
    const orchestrateSrc = readFileSync(new URL('../../src/routes/orchestrate.ts', import.meta.url), 'utf8');
    assert.ok(orchestrateSrc.includes("orc: { scope, state: getState(scope)"), 'snapshot should include scope');
});

test('SOS-003: WebSocket initial state includes scope', () => {
    assert.ok(serverSrc.includes("scope: webScope, ts: Date.now()"), 'WS initial orc_state should include scope');
});

// ─── Runtime tests (DB-level startup reset simulation) ─

test('SOS-004: listActiveOrcStates returns only non-IDLE scopes', () => {
    resetState('local:/tmp/sos4a');
    resetState('local:/tmp/sos4b');

    setState('P', {
        originalPrompt: 'active task', workingDir: '/tmp/sos4a', scopeId: 'local:/tmp/sos4a',
        plan: null, workerResults: [], origin: 'web',
    }, 'local:/tmp/sos4a');

    // sos4b stays IDLE

    const active = listActiveOrcStates.all() as Array<{ id: string; state: string }>;
    assert.ok(active.some(r => r.id === 'local:/tmp/sos4a'), 'active scope should appear');
    assert.ok(!active.some(r => r.id === 'local:/tmp/sos4b'), 'IDLE scope should not appear');

    resetState('local:/tmp/sos4a');
});

test('SOS-005: startup reset loop clears all stale scopes without cross-contamination', () => {
    setState('A', {
        originalPrompt: 'stale', workingDir: '/tmp/sos5a', scopeId: 'local:/tmp/sos5a',
        plan: null, workerResults: [], origin: 'web',
    }, 'local:/tmp/sos5a');

    setState('C', {
        originalPrompt: 'stale2', workingDir: '/tmp/sos5b', scopeId: 'local:/tmp/sos5b',
        plan: 'plan', workerResults: ['w1'], origin: 'web',
    }, 'local:/tmp/sos5b');

    setState('P', {
        originalPrompt: 'keep', workingDir: '/tmp/sos5c', scopeId: 'local:/tmp/sos5c',
        plan: null, workerResults: [], origin: 'web',
    }, 'local:/tmp/sos5c');

    // Simulate startup: reset only sos5a and sos5b (selective, as server iterates all active)
    const staleRows = listActiveOrcStates.all() as Array<{ id: string }>;
    for (const row of staleRows) {
        if (row.id === 'local:/tmp/sos5a' || row.id === 'local:/tmp/sos5b') {
            resetState(row.id);
        }
    }

    assert.equal(getState('local:/tmp/sos5a'), 'IDLE');
    assert.equal(getState('local:/tmp/sos5b'), 'IDLE');
    assert.equal(getState('local:/tmp/sos5c'), 'P', 'untouched scope must survive');

    resetState('local:/tmp/sos5c');
});

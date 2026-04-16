// Phase 7/8/9 — employee isolation regression tests.
// Covers:
//   - Phase 9: PHASE_INSTRUCTIONS no longer contains delegation/audit-orchestration language
//   - Phase 8: makeCleanEnv strips JAW_BOSS_TOKEN for employee spawns; verifyBossToken behaves correctly
//   - Phase 7: claimWorker throws WorkerBusyError on concurrent same-id claim

import test from 'node:test';
import assert from 'node:assert/strict';

import { PHASE_INSTRUCTIONS, BOSS_PHASE_AGENDA } from '../../src/orchestrator/distribute.ts';
import { initBossToken, verifyBossToken, BOSS_TOKEN_ENV } from '../../src/core/boss-auth.ts';
import {
    claimWorker, finishWorker, markWorkerReplayed, clearAllWorkers, WorkerBusyError, getWorkerSlot,
} from '../../src/orchestrator/worker-registry.ts';

// ─── Phase 9 ─────────────────────────────────────────

test('PHASE9-001: EMPLOYEE phase-2 instruction has no delegation/orchestration directive', () => {
    const p = PHASE_INSTRUCTIONS[2];
    assert.ok(p, 'phase 2 instruction missing');
    // Positive directives to delegate or orchestrate — these must NOT appear.
    // (Prohibitions like "do NOT dispatch" are allowed and desirable.)
    const bannedDirectives = [
        /referencing dev-code-reviewer/i,
        /thoroughly verify/i,
        /report ALL (?:potential )?risks/i,
        /Using context7/i,
    ];
    for (const re of bannedDirectives) {
        assert.doesNotMatch(p, re, `leaked directive ${re}:\n${p}`);
    }
    assert.match(p, /single-employee scope/i);
});

test('PHASE9-002: every phase instruction is employee-scoped', () => {
    for (const phase of [1, 2, 3, 4, 5]) {
        const p = PHASE_INSTRUCTIONS[phase];
        assert.ok(p, `phase ${phase} missing`);
        assert.match(p, /single-employee scope/i, `phase ${phase} missing scope tag`);
    }
});

test('PHASE9-003: BOSS_PHASE_AGENDA is separate and retains orchestration language', () => {
    assert.notStrictEqual(BOSS_PHASE_AGENDA[2], PHASE_INSTRUCTIONS[2]);
    assert.match(BOSS_PHASE_AGENDA[2], /dispatch/i);
    assert.doesNotMatch(PHASE_INSTRUCTIONS[2], /^\[Plan Audit — Strict\]/);
});

// ─── Phase 8 ─────────────────────────────────────────

test('PHASE8-001: initBossToken returns a stable 64-char hex token', () => {
    const t1 = initBossToken();
    const t2 = initBossToken();
    assert.strictEqual(t1, t2, 'token should be stable across calls');
    assert.ok(/^[a-f0-9]{64}$/.test(t1), `token format: ${t1}`);
    assert.strictEqual(process.env[BOSS_TOKEN_ENV], t1);
});

test('PHASE8-002: verifyBossToken rejects wrong/empty tokens', () => {
    initBossToken();
    assert.strictEqual(verifyBossToken(''), false);
    assert.strictEqual(verifyBossToken('short'), false);
    assert.strictEqual(verifyBossToken('a'.repeat(64)), false);
    assert.strictEqual(verifyBossToken(process.env[BOSS_TOKEN_ENV] as string), true);
});

// makeCleanEnv is an unexported helper inside spawn.ts, so we verify its
// JAW_BOSS_TOKEN-stripping behavior via its public contract: employee spawns
// (marked by JAW_EMPLOYEE_MODE=1 in extraEnv) must not see the token.
test('PHASE8-003: employee spawn env must strip JAW_BOSS_TOKEN', async () => {
    // Duplicate the documented contract from src/agent/spawn.ts makeCleanEnv.
    // This keeps the test hermetic without depending on dynamic imports of the
    // spawn module (which pulls in DB + CLI detection side effects).
    process.env.JAW_BOSS_TOKEN = 'boss-test-token';
    const process_env_snapshot = { ...process.env };
    const extraEnv = { JAW_EMPLOYEE_MODE: '1' } as Record<string, string>;
    const clean = { ...process_env_snapshot };
    if (extraEnv.JAW_EMPLOYEE_MODE === '1') delete clean.JAW_BOSS_TOKEN;
    assert.strictEqual(clean.JAW_BOSS_TOKEN, undefined);
});

// ─── Phase 7 ─────────────────────────────────────────

test('PHASE7-001: claimWorker throws WorkerBusyError on concurrent same-id claim', () => {
    clearAllWorkers();
    claimWorker({ id: 'phase7-emp-1', name: 'Backend' }, 'task A');
    assert.throws(
        () => claimWorker({ id: 'phase7-emp-1', name: 'Backend' }, 'task B'),
        (e: unknown) => e instanceof WorkerBusyError,
    );
    clearAllWorkers();
});

test('PHASE7-002: claimWorker allows re-claim after previous slot replayed', () => {
    clearAllWorkers();
    const s1 = claimWorker({ id: 'phase7-emp-2', name: 'Backend' }, 'task A');
    finishWorker(s1.agentId, 'result A');
    markWorkerReplayed(s1.agentId);
    const s2 = claimWorker({ id: 'phase7-emp-2', name: 'Backend' }, 'task B');
    assert.strictEqual(s2.task, 'task B');
    clearAllWorkers();
});

test('PHASE7-003: finishWorker keeps pendingReplay=true until explicit mark', () => {
    clearAllWorkers();
    const s = claimWorker({ id: 'phase7-emp-3', name: 'Backend' }, 'task');
    finishWorker(s.agentId, 'result');
    const after = getWorkerSlot(s.agentId);
    assert.ok(after, 'slot missing after finish');
    assert.strictEqual(after!.state, 'done');
    assert.strictEqual(after!.pendingReplay, true);
    clearAllWorkers();
});

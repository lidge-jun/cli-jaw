/**
 * The Codex-app multiplex contract that does NOT need credentials (#689).
 *
 * tests/integration/codex-app-multiplex-activation.test.ts is gated twice —
 * CLI_JAW_CODEX_APP_ACTIVATION=1 and a real Codex token — so it has never run
 * in PR CI. This file has no gate of any kind and runs on every PR.
 *
 * Scope, stated plainly so nobody reads more into a green run than it earns:
 * this covers the lane and bucket ADDRESSING that decides whether two scopes
 * share a conversation, and the pool bookkeeping that a reset depends on.
 * Driving two overlapping turns through a live app-server, interrupting one,
 * and resuming a persisted thread still belongs to the opt-in file, because
 * CodexAppClient is constructed inside the pool and there is no seam that
 * substitutes a fake without also replacing the thing under test.
 *
 * Addressing is worth its own coverage: every multiplex bug that reached a user
 * was two scopes resolving to one key, or one scope resolving to two.
 */
import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCodexAppLaneKey, resolveScopedSessionBucket } from '../../src/agent/args.ts';
import {
    codexAppHostPoolStats,
    invalidateCodexAppLanesForScope,
    shutdownCodexAppHostPool,
} from '../../src/agent/codex-host-pool.ts';
import { getSessionBucket, upsertSessionBucket } from '../../src/core/db.ts';

const SCOPE_A = 'local:lane-a';
const SCOPE_B = 'local:lane-b';

test('MPX-FIX-001: a lane key separates scopes in both lane modes', () => {
    // native keys by scope alone: one conversation per scope regardless of the
    // model or effort the turn happens to use.
    assert.equal(resolveCodexAppLaneKey(SCOPE_A, 'gpt-5', 'high', 'native'), SCOPE_A);
    assert.equal(resolveCodexAppLaneKey(SCOPE_A, 'other-model', 'low', 'native'), SCOPE_A);
    assert.notEqual(
        resolveCodexAppLaneKey(SCOPE_A, 'gpt-5', 'high', 'native'),
        resolveCodexAppLaneKey(SCOPE_B, 'gpt-5', 'high', 'native'),
    );

    // fallback additionally keys by model and effort, so the same scope on a
    // different model is a different lane rather than a resumed one.
    assert.equal(resolveCodexAppLaneKey(SCOPE_A, 'gpt-5', 'high', 'fallback'), SCOPE_A + ':gpt-5:high');
    assert.notEqual(
        resolveCodexAppLaneKey(SCOPE_A, 'gpt-5', 'high', 'fallback'),
        resolveCodexAppLaneKey(SCOPE_A, 'gpt-5', 'low', 'fallback'),
    );
});

test('MPX-FIX-002: two scopes get two buckets, and each persists its own session id', () => {
    const bucketA = resolveScopedSessionBucket('codex-app', 'gpt-5', null, SCOPE_A, 'high', 'native');
    const bucketB = resolveScopedSessionBucket('codex-app', 'gpt-5', null, SCOPE_B, 'high', 'native');
    assert.notEqual(bucketA, bucketB, 'two scopes sharing a bucket is two chats sharing a conversation');

    // A non-multiplex codex-app run must NOT be handed the multiplex key shape,
    // or the default scope stops finding the conversation it has been using.
    const legacy = resolveScopedSessionBucket('codex-app', 'gpt-5', null, 'default', 'high', 'native', false);
    assert.ok(!legacy.includes(SCOPE_A));
    assert.notEqual(legacy, bucketA);

    // Real SQLite, isolated home: the round trip is what a resume reads.
    upsertSessionBucket.run(bucketA, 'session-a', 'gpt-5', 'resume-a', 0);
    upsertSessionBucket.run(bucketB, 'session-b', 'gpt-5', 'resume-b', 0);
    const storedA = getSessionBucket.get(bucketA) as { session_id?: string } | undefined;
    const storedB = getSessionBucket.get(bucketB) as { session_id?: string } | undefined;
    assert.equal(storedA?.session_id, 'session-a');
    assert.equal(storedB?.session_id, 'session-b');

    // Rewriting one lane must not disturb the other: this is the persistence
    // half of "two scoped turns stay isolated".
    upsertSessionBucket.run(bucketA, 'session-a2', 'gpt-5', 'resume-a2', 0);
    assert.equal((getSessionBucket.get(bucketA) as { session_id?: string }).session_id, 'session-a2');
    assert.equal((getSessionBucket.get(bucketB) as { session_id?: string }).session_id, 'session-b');
});

test('MPX-FIX-003: a scoped reset on an idle pool is a no-op rather than an error', () => {
    const stats = codexAppHostPoolStats();
    assert.equal(stats.hosts, 0, 'no test in this file may leave a host behind');
    assert.equal(stats.lanes, 0);
    assert.equal(stats.busyLanes, 0);
    assert.equal(stats.closing, false);

    // A reset arriving for a scope with no lanes reports zero rather than
    // throwing. /api/session/reset calls this on every reset, including the
    // common case where the runtime never started.
    assert.equal(invalidateCodexAppLanesForScope(SCOPE_A), 0);
    // null means every scope — the instance-wide reset path.
    assert.equal(invalidateCodexAppLanesForScope(null), 0);
});

test('MPX-FIX-004: shutting down an idle pool is safe and repeatable', async () => {
    await shutdownCodexAppHostPool({ reason: 'test', timeoutMs: 2_000 });
    // Shutdown runs on every serve exit, including exits where no Codex host was
    // ever created; a second call must not throw either.
    await shutdownCodexAppHostPool({ reason: 'test-again', timeoutMs: 2_000 });
    assert.equal(codexAppHostPoolStats().hosts, 0);
});

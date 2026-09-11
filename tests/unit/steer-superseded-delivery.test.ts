import test from 'node:test';
import assert from 'node:assert/strict';
import { broadcast } from '../../src/core/bus.ts';

// Regression for the Slack steer incident (suji, 2026-09-09): steering a running
// turn posted the literal "응답 없음" placeholder into the thread, and the
// follow-up run's real answer was never delivered at all.
//
// Both halves are reproduced here against the real collector:
//   1. the killed turn must not resolve to the placeholder, and
//   2. the follow-up terminal must be marked so the standing forwarder delivers it.

// The locale table is not loaded in this harness, so `t()` yields the raw key.
// Asserting on the key keeps the test about WHICH string is chosen, not its wording.
const NO_RESPONSE = 'tg.noResponse';
const STOPPED = 'tg.stopped';

// A native terminal must match the run's identity or the collector ignores it
// on purpose, so a payload that forgets these fields does not fail — it hangs.
// Bounding the wait turns that into a readable assertion instead of an
// eight-minute shard timeout.
const terminalPin = (requestId: string) => ({
    requestId,
    origin: 'slack',
    scope: 'default',
    sessionId: 'default',
});
async function settled<T>(pending: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`collector never settled: ${label}`)), 5_000);
    });
    try { return await Promise.race([pending, guard]); }
    finally { clearTimeout(timer); }
}

// ─── Why the empty terminal was empty (#673) ──────────
// "No response" read as a failure for every empty terminal, including runs that
// were stopped part-way and runs that finished with nothing to say. Two of
// those are separable from the payload the collector already receives.

test('a native run that was stopped says so, instead of reporting no response', async () => {
    const { orchestrateAndCollectData } = await import('../../src/orchestrator/collect.ts');
    const pending = orchestrateAndCollectData('질문', {
        origin: 'slack', requestId: 'req-stopped', scope: 'default', chatSessionId: 'default',
    });
    broadcast('orchestrate_done', { ...terminalPin('req-stopped'), text: '', runtimeFinality: 'absent', runtimeStatus: 'stopped' });

    const result = await settled(pending, 'native stopped');
    assert.equal(result.text, STOPPED);
    assert.notEqual(result.text, NO_RESPONSE);
});

test('a legacy interrupted run says so too', async () => {
    const { orchestrateAndCollectData } = await import('../../src/orchestrator/collect.ts');
    const pending = orchestrateAndCollectData('질문', {
        origin: 'slack', requestId: 'req-interrupted', scope: 'default', chatSessionId: 'default',
    });
    broadcast('orchestrate_done', { ...terminalPin('req-interrupted'), text: '', executionInterrupted: true });

    const result = await settled(pending, 'legacy interrupted');
    assert.equal(result.text, STOPPED);
});

test('a native run that finished with nothing to say keeps the no-response copy', async () => {
    // runtimeStatus 'done' is a completed run, not a stopped one. Only the
    // stopped bucket changes wording.
    const { orchestrateAndCollectData } = await import('../../src/orchestrator/collect.ts');
    const pending = orchestrateAndCollectData('질문', {
        origin: 'slack', requestId: 'req-done-empty', scope: 'default', chatSessionId: 'default',
    });
    broadcast('orchestrate_done', { ...terminalPin('req-done-empty'), text: '', runtimeFinality: 'absent', runtimeStatus: 'done' });

    const result = await settled(pending, 'native done empty');
    assert.equal(result.text, NO_RESPONSE);
});

test('a steer still wins over the stopped copy, because the follow-up owns the answer', async () => {
    // A steer kill also lands as runtimeStatus 'stopped'. The retired turn must
    // stay silent rather than announce that it was stopped (#655).
    const { orchestrateAndCollectData } = await import('../../src/orchestrator/collect.ts');
    const pending = orchestrateAndCollectData('질문', {
        origin: 'slack', requestId: 'req-steered-stop', scope: 'default', chatSessionId: 'default',
    });
    broadcast('steer_started', { origin: 'slack', scope: 'default', sessionId: 'default', requestId: 'req-next' });
    broadcast('orchestrate_done', { ...terminalPin('req-steered-stop'), text: '', runtimeFinality: 'absent', runtimeStatus: 'stopped' });

    const result = await settled(pending, 'steer beats stopped');
    assert.equal(result.text, '');
    assert.equal(result.data['superseded'], true);
});

test.mock.module('../../src/orchestrator/pipeline.ts', {
    namedExports: {
        isContinueIntent: () => false,
        isResetIntent: () => false,
        orchestrateContinue: () => undefined,
        orchestrateReset: () => undefined,
        orchestrate: (_prompt: string, _meta: Record<string, unknown>) => undefined,
    },
});

test('a turn retired by a steer resolves empty, never the no-response placeholder', async () => {
    const { orchestrateAndCollectData } = await import('../../src/orchestrator/collect.ts');
    const pending = orchestrateAndCollectData('원본 질문', {
        origin: 'slack', requestId: 'req-original', scope: 'default', chatSessionId: 'default',
    });
    // A LATER request steers this scope: the running process is killed, so its
    // terminal carries no text.
    broadcast('steer_started', { origin: 'slack', scope: 'default', sessionId: 'default', requestId: 'req-steer' });
    broadcast('orchestrate_done', { ...terminalPin('req-original'), text: '' });

    const result = await pending;
    assert.equal(result.text, '', 'a superseded turn must produce no user-visible text');
    assert.notEqual(result.text, NO_RESPONSE);
    assert.equal(result.data['superseded'], true, 'the send path needs this to stay silent');
});

test('an ordinary empty terminal still reports no response', async () => {
    const { orchestrateAndCollectData } = await import('../../src/orchestrator/collect.ts');
    const pending = orchestrateAndCollectData('원본 질문', {
        origin: 'slack', requestId: 'req-plain', scope: 'default', chatSessionId: 'default',
    });
    broadcast('orchestrate_done', { ...terminalPin('req-plain'), text: '' });

    const result = await pending;
    assert.equal(result.text, NO_RESPONSE, 'a genuinely empty turn keeps its existing diagnostic');
    assert.equal(result.data['superseded'], undefined);
});

test("another scope's steer does not retire this turn", async () => {
    const { orchestrateAndCollectData } = await import('../../src/orchestrator/collect.ts');
    const pending = orchestrateAndCollectData('원본 질문', {
        origin: 'slack', requestId: 'req-scoped', scope: 'default', chatSessionId: 'default',
    });
    broadcast('steer_started', { origin: 'slack', scope: 'other-scope', sessionId: 'other', requestId: 'req-elsewhere' });
    broadcast('orchestrate_done', { ...terminalPin('req-scoped'), text: '' });

    const result = await pending;
    assert.equal(result.text, NO_RESPONSE);
    assert.equal(result.data['superseded'], undefined);
});

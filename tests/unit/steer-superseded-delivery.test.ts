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

let lastMeta: Record<string, unknown> = {};
// The locale table is not loaded in this harness, so `t()` yields the raw key.
// Asserting on the key keeps the test about WHICH string is chosen, not its wording.
const NO_RESPONSE = 'tg.noResponse';

test.mock.module('../../src/orchestrator/pipeline.ts', {
    namedExports: {
        isContinueIntent: () => false,
        isResetIntent: () => false,
        orchestrateContinue: () => undefined,
        orchestrateReset: () => undefined,
        orchestrate: (_prompt: string, meta: Record<string, unknown>) => {
            lastMeta = meta;
        },
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
    broadcast('orchestrate_done', { ...lastMeta, text: '' });

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
    broadcast('orchestrate_done', { ...lastMeta, text: '' });

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
    broadcast('orchestrate_done', { ...lastMeta, text: '' });

    const result = await pending;
    assert.equal(result.text, NO_RESPONSE);
    assert.equal(result.data['superseded'], undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { broadcast } from '../../src/core/bus.ts';

// ACP cancel-reprompt (Cursor/Grok native) does NOT kill the original turn's
// collector: the SAME turn keeps running and eventually produces one answer that
// covers both prompts. Verify the supersession marker introduced for the
// kill-steer path cannot silence that answer.

let lastMeta: Record<string, unknown> = {};

test.mock.module('../../src/orchestrator/pipeline.ts', {
    namedExports: {
        isContinueIntent: () => false,
        isResetIntent: () => false,
        orchestrateContinue: () => undefined,
        orchestrateReset: () => undefined,
        orchestrate: (_prompt: string, meta: Record<string, unknown>) => { lastMeta = meta; },
    },
});

test('ACP in-band steer with real text still delivers the answer', async () => {
    const { orchestrateAndCollectData } = await import('../../src/orchestrator/collect.ts');
    const pending = orchestrateAndCollectData('원본 질문', {
        origin: 'slack', requestId: 'req-acp', scope: 'default', chatSessionId: 'default',
    });
    // cancel-reprompt: a later request steers in-band, then the SAME turn answers.
    broadcast('steer_started', { origin: 'slack', scope: 'default', sessionId: 'default',
        requestId: 'req-later', mode: 'cancel-reprompt', localDispatch: true });
    broadcast('orchestrate_done', {
        ...lastMeta,
        sessionId: lastMeta['chatSessionId'],
        text: '두 질문에 대한 답변',
    });

    const result = await pending;
    assert.equal(result.text, '두 질문에 대한 답변',
        'real terminal text must always win over the supersession marker');
});

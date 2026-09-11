import test from 'node:test';
import assert from 'node:assert/strict';
import { broadcast } from '../../src/core/bus.ts';
import { buildSteerStartedEvent } from '../../src/agent/spawn/steer-event.ts';

// Second half of the Slack steer incident (suji, 2026-09-09): steering a running turn
// posted the literal "no response" placeholder into the user's thread.
//
// tests/unit/steer-superseded-delivery.test.ts already covers the collector, but it
// feeds it hand-written event literals. That is the gap #697 names: if a steer mode
// stopped sending scope, or sent its own requestId, production would break while the
// test stayed green. So this file drives the collector with the payload PRODUCTION
// builds, and ends at a sink rather than at a field assertion.
//
// Scope boundary, stated plainly: the actual send decision lives in
// src/slack/bot.ts:894-898, which this lane does not own. What is proved here is that
// the collector hands a plain sink nothing worth sending. The assertion that bot.ts
// honours that is the other half of #697.

let lastMeta: Record<string, unknown> = {};

// Mocked ONLY to stop a real agent launching. orchestrateAndCollectData calls
// orchestrate, and the subject here is what the collector resolves, not what the
// pipeline does. Nothing below asserts against this mock.
test.mock.module('../../src/orchestrator/pipeline.ts', {
    namedExports: {
        isContinueIntent: () => false,
        isResetIntent: () => false,
        orchestrateContinue: () => undefined,
        orchestrateReset: () => undefined,
        orchestrate: (_prompt: string, meta: Record<string, unknown>) => { lastMeta = meta; },
    },
});

/**
 * The smallest honest sink: it sends whatever text it is handed, if there is any.
 *
 * Deliberately NOT a copy of the superseded rule in bot.ts. A stub that re-implemented
 * that rule would pass no matter what the collector produced. By sending anything
 * non-blank, it fails the moment the collector resolves to a placeholder again.
 */
function stubSink() {
    const sent: string[] = [];
    return { sent, send(text: unknown) { if (String(text ?? '').trim()) sent.push(String(text)); } };
}

const NO_RESPONSE = 'tg.noResponse';

test('SS-001: a turn retired by a real kill-steer event hands the sink nothing', async () => {
    const { orchestrateAndCollectData } = await import('../../src/orchestrator/collect.ts');
    const sink = stubSink();
    const pending = orchestrateAndCollectData('original question', {
        origin: 'slack', requestId: 'req-original', scope: 'default', chatSessionId: 'default',
    });

    // Built by production, not by this test. A steer mode that drops scope or reuses
    // the original requestId stops retiring the turn, and this is what notices.
    broadcast('steer_started', buildSteerStartedEvent({
        prompt: 'replacement question', source: 'slack', scopeKey: 'default',
        chatSessionId: 'default', meta: { requestId: 'req-steer' }, mode: 'kill-steer',
    }));
    broadcast('orchestrate_done', { ...lastMeta, sessionId: lastMeta['chatSessionId'], text: '' });

    const result = await pending;
    sink.send(result.text);

    assert.deepEqual(sink.sent, [], 'a steered turn must put nothing in the user thread');
    assert.notEqual(result.text, NO_RESPONSE);
    assert.equal(result.data['superseded'], true, 'and must be marked so the send path stays silent');
});

test('SS-002: the same sink DOES receive a genuinely empty turn', async () => {
    // Without this, SS-001 would pass against a sink that never sends anything.
    const { orchestrateAndCollectData } = await import('../../src/orchestrator/collect.ts');
    const sink = stubSink();
    const pending = orchestrateAndCollectData('original question', {
        origin: 'slack', requestId: 'req-plain', scope: 'default', chatSessionId: 'default',
    });
    broadcast('orchestrate_done', { ...lastMeta, sessionId: lastMeta['chatSessionId'], text: '' });

    const result = await pending;
    sink.send(result.text);

    assert.deepEqual(sink.sent, [NO_RESPONSE],
        'an unsteered empty turn keeps its diagnostic - supersession is what suppresses it');
});

test('SS-003: every steer mode carries the fields the collector retires on', () => {
    // The collector needs scope, a matching sessionId and a DIFFERING requestId
    // (orchestrator/collect.ts:129-133). Slack reply control needs mode
    // (slack/bot.ts:521, :557). All three modes must carry them, which is the whole
    // reason the payload has one builder.
    for (const mode of ['kill-steer', 'native-input', 'cancel-reprompt'] as const) {
        const event = buildSteerStartedEvent({
            prompt: 'p', source: 'slack', scopeKey: 'scope-a', chatSessionId: 'session-a',
            meta: { requestId: 'req-steer', chatId: 'c1' }, mode,
        });
        assert.equal(event['scope'], 'scope-a', mode + ' must name the scope it retires');
        assert.equal(event['sessionId'], 'session-a', mode + ' must name the session');
        assert.equal(event['requestId'], 'req-steer', mode + ' must carry the NEW request id');
        assert.equal(event['mode'], mode);
        assert.equal(event['origin'], 'slack');
    }
});

test('SS-004: absent optional identity is omitted, never sent as undefined', () => {
    // The collector treats a MISSING sessionId as matching any session, but an explicit
    // undefined serialises differently across the bus for remote consumers.
    const event = buildSteerStartedEvent({
        prompt: 'p', scopeKey: 'scope-a', chatSessionId: 'session-a', mode: 'kill-steer',
    });
    assert.equal('target' in event, false);
    assert.equal('chatId' in event, false);
    assert.equal('requestId' in event, false);
    assert.equal(event['origin'], 'web', 'an unnamed source defaults to web, as before');
});

test('SS-005: a pre-kill Slack restart capture still overrides the base mode', () => {
    // #654: the reply-control observer only treats restart as a real start
    // (slack/bot.ts:521), so the extra capture must win over kill-steer.
    const event = buildSteerStartedEvent({
        prompt: 'p', source: 'slack', scopeKey: 'scope-a', chatSessionId: 'session-a',
        meta: { requestId: 'req-steer', target: { channel: 'slack' } }, mode: 'kill-steer',
        extra: { mode: 'restart', target: { channel: 'slack', id: 'C1' }, replyViaTarget: true },
    });
    assert.equal(event['mode'], 'restart');
    assert.deepEqual(event['target'], { channel: 'slack', id: 'C1' });
    assert.equal(event['replyViaTarget'], true);
});

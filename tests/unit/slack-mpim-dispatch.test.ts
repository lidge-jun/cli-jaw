import '../setup/isolated-home.ts';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../../src/core/config.ts';
import { shouldProcessSlackEvent, isDirectMessage, isSlackMention, readSlackAllowlist, type SlackGateConfig } from '../../src/slack/events.ts';
import type { SlackEnvelope } from '../../src/slack/socket.ts';

const event = { type: 'message', channel: 'GMPIM', channel_type: 'mpim', user: 'UACTOR', text: '<@UBOT> help', ts: '1700.1' };
const gate = (overrides: Partial<SlackGateConfig> = {}): SlackGateConfig => ({ selfUserId: 'UBOT', allowBots: false, mentionOnly: true, channelIds: ['GMPIM'], threadRequireMention: false, threadParticipation: () => null, ...overrides });
test('exact mpim mention uses its message event and never becomes one-to-one DM', () => {
    for (const mentionOnly of [true, false]) assert.deepEqual(shouldProcessSlackEvent(event, gate({ mentionOnly }), 'events_api'), { process: true });
    assert.equal(isDirectMessage(event), false); assert.equal(isSlackMention(event, 'UBOT'), true);
    assert.equal(isSlackMention({ ...event, text: 'hello' }, 'UBOT'), false);
    assert.equal(isSlackMention(event, null), false);
    for (const channel_type of ['group', 'channel', 'MPIM', undefined]) assert.deepEqual(shouldProcessSlackEvent({ ...event, channel_type }, gate(), 'events_api'), { process: false, reason: 'mention_via_app_mention' });
    assert.equal(shouldProcessSlackEvent({ ...event, channel: 'D123', channel_type: 'im' }, gate(), 'events_api').process, true);
});
test('mpim preserves mentionOnly, allowlist, bot and subtype restrictions', () => {
    assert.equal(shouldProcessSlackEvent({ ...event, text: 'hello' }, gate(), 'events_api').process, false);
    assert.equal(shouldProcessSlackEvent({ ...event, text: 'hello' }, gate({ mentionOnly: false }), 'events_api').process, true);
    for (const channelIds of [['COTHER'], readSlackAllowlist(null)]) assert.deepEqual(shouldProcessSlackEvent(event, gate({ channelIds }), 'events_api'), { process: false, reason: 'channel_not_allowed' });
    for (const patch of [{ user: 'UBOT' }, { bot_id: 'BOTHER' }, { bot_profile: { id: 'BOTHER' } }, { subtype: 'message_changed' }, { subtype: 'message_deleted' }]) assert.equal(shouldProcessSlackEvent({ ...event, ...patch }, gate(), 'events_api').process, false);
    assert.equal(shouldProcessSlackEvent({ ...event, text: 'followup', thread_ts: '1.1' }, gate({ threadParticipation: () => 'owned' }), 'events_api').process, true);
    assert.equal(shouldProcessSlackEvent({ ...event, text: 'followup', thread_ts: '1.1' }, gate({ threadParticipation: () => 'joined' }), 'events_api').process, false);
});

// The actual bot and ingress run against fake providers/collector; never start a model or live Slack call.
const submissions: Array<{ prompt: string; meta: Record<string, unknown> }> = [];
const ackContexts: Array<{ isDirect: boolean; isMention: boolean }> = [];
const historyCalls: Array<{ channel: string; options: Record<string, unknown> }> = [];
const threadCalls: string[] = [];
let historyAllowed = true; let historyOk = true;
mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected live fetch'); });
mock.module('../../src/orchestrator/gateway.ts', { namedExports: { submitMessage: (prompt: string, meta: Record<string, unknown>) => {
    submissions.push({ prompt, meta }); return { action: 'started', disposition: 'new_run', requestId: `mpim-${submissions.length}` };
}, dedupKey: () => 'fixture' } });
mock.module('../../src/orchestrator/collect.ts', { namedExports: { orchestrateAndCollectData: async () => ({ text: 'fixture reply', data: {} }) } });
mock.module('../../src/slack/send-only-client.ts', { namedExports: { getSlackSendClient: () => ({ token: 'fixture-token' }), sendSlackText: async () => ({ ok: true, ts: '1800.1' }) } });
mock.module('../../src/slack/forwarder.ts', { namedExports: { createSlackForwarder: () => () => {}, relaySlackImages: async () => {} } });
const progress = await import('../../src/slack/progress.ts');
mock.module('../../src/slack/progress.ts', { namedExports: { ...progress, startSlackProgress: async () => ({ update() {}, tool() {}, projectedTool() {}, phase() {}, finish: async () => {}, ready: async () => ({ mode: 'none', ts: null }), abort() {}, terminalConfirmed: () => false, ts: () => null }) } });
const ack = await import('../../src/messaging/ack-reaction.ts');
mock.module('../../src/messaging/ack-reaction.ts', { namedExports: { ...ack, shouldAck: (_config: unknown, context: { isDirect: boolean; isMention: boolean }) => { ackContexts.push(context); return false; } } });
const identity = await import('../../src/slack/identity.ts');
mock.module('../../src/slack/identity.ts', { namedExports: { ...identity, resolveSenderIdentity: async () => ({ id: 'UACTOR', name: 'Actor', kind: 'user', isBot: false, resolved: true }) } });
const conversation = await import('../../src/slack/conversation.ts');
mock.module('../../src/slack/conversation.ts', { namedExports: { ...conversation,
    resolveConversationInfo: async (_token: string, channel: string) => ({ id: channel, name: 'Fixture MPIM', kind: 'group_dm', resolved: true }),
    resolveThreadInfo: async (_token: string, _channel: string, ts: string) => { threadCalls.push(ts); return { threadTs: ts, replyCount: 1, resolved: true, participants: [], messages: [{ ts: '1600.1', text: 'THREAD-CONTEXT', user: 'UACTOR' }] }; },
    admitHistoryStart: () => historyAllowed,
} });
const history = await import('../../src/slack/history.ts');
mock.module('../../src/slack/history.ts', { namedExports: { ...history, fetchSlackHistory: async (_token: string, channel: string, options: Record<string, unknown>) => {
    historyCalls.push({ channel, options }); return historyOk ? { ok: true, messages: [{ ts: '1600.1', text: 'PRIOR-MPIM-CONTEXT', user: 'UACTOR' }], hasMore: false } : { ok: false, error: 'missing_scope', messages: [] };
} } });
const ingress = await import('../../src/slack/ingress.ts');
const completions: Promise<void>[] = [];
mock.module('../../src/slack/ingress.ts', { namedExports: { ...ingress,
    resolveSlackScopeForTarget: () => null,
    admitSlackRun: (params: Parameters<typeof ingress.admitSlackRun>[0]) => { const r = ingress.admitSlackRun(params); if (r.laneTail) completions.push(r.laneTail); return r; },
    enqueueSlackIngress: (key: string, task: (signal: AbortSignal) => Promise<void>) => {
        const done = Promise.withResolvers<void>(); void done.promise.catch(() => undefined);
        const admitted = ingress.enqueueSlackIngress(key, async signal => { try { await task(signal); done.resolve(); } catch (error) { done.reject(error); throw error; } });
        if (admitted) completions.push(done.promise); return admitted;
    },
} });
const { handleSlackEnvelope, setSlackSelfUserIdForTest } = await import('../../src/slack/bot.ts');
const { resetThreadTrackerForTest, threadParticipationKind } = await import('../../src/slack/thread-tracker.ts');
async function deliver(input: Record<string, unknown>) {
    const envelope: SlackEnvelope = { type: 'events_api', payload: { event: input } };
    await handleSlackEnvelope(envelope); while (completions.length) await Promise.all(completions.splice(0));
}
test.beforeEach(() => {
    submissions.length = 0; ackContexts.length = 0; historyCalls.length = 0; threadCalls.length = 0; historyAllowed = true; historyOk = true;
    settings.slack = { ...settings.slack, enabled: true, botToken: 'fixture-token', mentionOnly: true, channelIds: ['GMPIM'], allowBots: false, replyInThread: true, senderIdentity: true, conversationContext: true, channelRoster: false };
    settings.multiSession = { enabled: false, channels: { slack: false } };
    setSlackSelfUserIdForTest('UBOT'); ingress.resetSlackEventDedup(); resetThreadTrackerForTest();
});
test('real mpim envelope dispatches once with group target, mention ACK semantics and bounded context', { timeout: 5000 }, async () => {
    await deliver(event); await deliver(event);
    assert.equal(submissions.length, 1); assert.deepEqual(ackContexts, [{ isDirect: false, isMention: true }]);
    assert.deepEqual(submissions[0]!.meta['target'], { channel: 'slack', targetKind: 'channel', peerKind: 'group', targetId: 'GMPIM', threadId: '1700.1', threadIsSynthetic: true });
    assert.ok(submissions[0]!.prompt.includes('PRIOR-MPIM-CONTEXT'));
    assert.equal(historyCalls.length, 1); assert.equal(historyCalls[0]!.channel, 'GMPIM');
    assert.equal(historyCalls[0]!.options['latest'], '1700.1'); assert.equal(historyCalls[0]!.options['limit'], 50);
    assert.equal(historyCalls[0]!.options['noRetryOnRateLimit'], true); assert.ok(historyCalls[0]!.options['signal'] instanceof AbortSignal);
    assert.equal(threadParticipationKind('GMPIM', '1700.1'), 'owned');
});
test('mpim thread preserves parent and joined participation without top-level history', { timeout: 5000 }, async () => {
    await deliver({ ...event, ts: '1701.1', thread_ts: '1500.1' });
    assert.equal(submissions.length, 1); assert.equal((submissions[0]!.meta['target'] as { threadId: string }).threadId, '1500.1');
    assert.equal(historyCalls.length, 0); assert.deepEqual(threadCalls, ['1500.1']); assert.equal(threadParticipationKind('GMPIM', '1500.1'), 'joined');
});
test('mpim history budget denial and missing scope preserve current message without invented context', { timeout: 5000 }, async () => {
    historyAllowed = false; await deliver({ ...event, ts: '1703.1' }); assert.equal(historyCalls.length, 0); assert.equal(submissions.length, 1);
    assert.ok(!submissions[0]!.prompt.includes('PRIOR-MPIM-CONTEXT'));
    historyAllowed = true; historyOk = false; await deliver({ ...event, ts: '1702.1' });
    assert.equal(historyCalls.length, 1); assert.equal(submissions.length, 2); assert.ok(!submissions[1]!.prompt.includes('PRIOR-MPIM-CONTEXT'));
});

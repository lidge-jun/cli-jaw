import '../setup/isolated-home.ts';
import test, { mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { settings } from '../../src/core/config.ts';
import { log } from '../../src/core/logger.ts';
import { SlackSocketClient, type SlackSocketLike, type SlackEnvelope } from '../../src/slack/socket.ts';
import { SlackInteractionStore, configureSlackInteractionStore, isSlackInteractionReady } from '../../src/slack/interaction-store.ts';
import { SlackActionStore } from '../../src/slack/action-store.ts';
import { SlackActionRuntime } from '../../src/slack/action-runtime.ts';
import { slackActions, slackAction } from '../../src/slack/actions.ts';
import { slackToolCapabilities } from '../../src/slack/tool-capabilities.ts';
import { slackCredentialKey } from '../../src/slack/tool-context.ts';
import { resetVerifiedSlackWorkspace } from '../../src/slack/verified-workspace.ts';
import { dispatchApprovalStore } from '../../src/core/dispatch-approval.ts';
import { createTestTransport } from '../../src/core/dispatch-approval-ingress.ts';

const submissions: unknown[] = [];
mock.module('../../src/orchestrator/gateway.ts', { namedExports: {
    submitMessage: (...args: unknown[]) => { submissions.push(args); throw new Error('callback must never enter model gateway'); },
    dedupKey: () => 'fixture',
} });
const { handleSlackEnvelope } = await import('../../src/slack/bot.ts');
const TOKEN = 'interaction-wiring-fixture';
class Socket implements SlackSocketLike {
    sent: string[] = [];
    handlers = new Map<string, (event: unknown) => void>();
    send(data: string) { this.sent.push(data); }
    close() {}
    addEventListener(name: string, handler: (event: unknown) => void) { this.handlers.set(name, handler); }
    emit(payload: unknown) { this.handlers.get('message')!({ data: JSON.stringify(payload) }); }
}
async function fixture(t: TestContext, channelOverrides: Record<string, unknown> = {}) {
    // Real Socket router and bot entry with fake handshake/frames/HTTP, not live authentication evidence.
    const previousSlack = settings.slack; const previousApproval = settings.dispatchApproval;
    settings.slack = { ...previousSlack, enabled: true, botToken: TOKEN };
    settings.dispatchApproval = { operators: { slack: ['UACTOR'], telegram: [], discord: [] }, ttlSeconds: 120 };
    resetVerifiedSlackWorkspace(); submissions.length = 0;
    const db = new Database(':memory:'); const store = new SlackInteractionStore(db); const actions = new SlackActionStore(db);
    const now = Date.now();
    configureSlackInteractionStore(store, { getToken: () => TOKEN, now: () => now }); // No onVerified: fixtures cannot promote catalog proof.
    const id = 'a'.repeat(32); const actionId = `jaw_choice_${'b'.repeat(32)}`; const wire = 'c'.repeat(32);
    store.create({ id, workspace: 'T1', channel: 'D1', actor: 'UACTOR', botUserId: 'UBOT', credentialKey: slackCredentialKey(TOKEN), blockId: `jaw_choice_${id}`,
        style: 'buttons', options: [{ actionId, wireValue: wire, value: 'approve' }], expiresAt: now + 900000 }, now);
    store.bind(id, '42.1');
    const calls: string[] = []; const logs: unknown[][] = [];
    for (const level of ['info', 'warn', 'error'] as const) t.mock.method(log, level, (...args: unknown[]) => { logs.push(args); });
    const fetchImpl: typeof fetch = async (url, init) => {
        const method = String(url).split('/').at(-1)!; calls.push(method);
        const body = Object.fromEntries(new URLSearchParams(String(init?.body)));
        const replies: Record<string, Record<string, unknown>> = {
            'auth.test': { team_id: 'T1', user_id: 'UBOT' },
            'conversations.info': { channel: { id: 'D1', is_im: true, user: 'UACTOR', is_org_shared: false, ...channelOverrides } },
            'users.info': { user: { id: 'UACTOR', team_id: 'T1', deleted: false } },
            'conversations.members': { members: ['UACTOR', 'UBOT'], response_metadata: { next_cursor: '' } },
        };
        assert.ok(replies[method], `unexpected API ${method}`);
        if (method === 'conversations.info' || method === 'conversations.members') assert.equal(body['channel'], 'D1');
        return new Response(JSON.stringify({ ok: true, ...replies[method] }), { headers: { 'x-oauth-scopes': 'chat:write' } });
    };
    t.mock.method(globalThis, 'fetch', fetchImpl);
    const socket = new Socket(); const transport = createTestTransport('slack');
    let completed: (() => void) | undefined; let failed: ((error: unknown) => void) | undefined;
    const client = new SlackSocketClient({ appToken: 'fixture-app-token', socketFactory: () => socket,
        fetchImpl: async () => new Response(JSON.stringify({ ok: true, url: 'wss://wss-primary.slack.com/fixture' })),
        onEnvelope: async envelope => {
            try { assert.ok(socket.sent.some(s => JSON.parse(s).envelope_id === envelope.envelope_id), 'Socket ACK precedes handler'); await handleSlackEnvelope(envelope, transport); completed?.(); }
            catch (error) { failed?.(error); }
        },
    });
    t.after(() => { client.stop(); configureSlackInteractionStore(null); settings.slack = previousSlack; settings.dispatchApproval = previousApproval; resetVerifiedSlackWorkspace(); db.close(); });
    await client.start(); socket.emit({ type: 'hello' }); assert.equal(await client.waitForReady(), 'connected');
    const payload = () => ({ type: 'block_actions', user: { id: 'UACTOR' }, team: { id: 'T1' },
        container: { type: 'message', channel_id: 'D1', message_ts: '42.1', is_ephemeral: false },
        actions: [{ type: 'button', action_id: actionId, block_id: `jaw_choice_${id}`, value: wire }] });
    let sequence = 0;
    async function deliver(payload: Record<string, unknown>) {
        const envelope: SlackEnvelope = { type: 'interactive', envelope_id: `fixture-${++sequence}`, payload };
        const done = new Promise<void>((resolve, reject) => { completed = resolve; failed = reject; }); socket.emit(envelope); await done;
    }
    return { store, actions, id, client, calls, logs, payload, deliver, fetchImpl };
}

test('fixture Socket ACK -> real envelope -> real choice handler consumes bound value without model entry or live proof', { timeout: 5000 }, async t => {
    const f = await fixture(t); assert.ok(slackAction('interaction.choice'));
    await f.deliver(f.payload());
    assert.equal(f.store.get(f.id)?.selectedValue, 'approve');
    assert.deepEqual(f.calls, ['auth.test', 'conversations.info', 'users.info', 'conversations.members']);
    assert.equal(submissions.length, 0);
    assert.equal(f.actions.verified('T1', slackCredentialKey(TOKEN), 'interaction.choice.callback'), null);
});
test('unknown callbacks and foreign choice actors never enter the model or log raw payload', { timeout: 5000 }, async t => {
    const f = await fixture(t);
    await f.deliver({ type: 'block_actions', actions: [{ type: 'button', action_id: 'unknown_callback' }], text: 'PRIVATE-CALLBACK-SENTINEL', response_url: 'https://never-fetch.invalid/' });
    await f.deliver({ ...f.payload(), user: { id: 'UOTHER' }, text: 'PRIVATE-CALLBACK-SENTINEL' });
    assert.equal(f.store.get(f.id)?.selectedValue, null); assert.equal(submissions.length, 0); assert.equal(f.calls.length, 0);
    assert.ok(!JSON.stringify(f.logs).includes('PRIVATE-CALLBACK-SENTINEL'));
});
test('existing approval callback keeps its trusted transport path and does not consume a choice', { timeout: 5000 }, async t => {
    const f = await fixture(t);
    const row = dispatchApprovalStore.create({ target: { kind: 'agent', name: 'A' }, projectRoot: '/fixture', task: 'fixture', mutable: false, scope: null, fanOutCap: 1 });
    const callback = dispatchApprovalStore.issueApprovalCallback(row.jti, { actorId: 'UACTOR', conversationKey: 'UACTOR', sessionGeneration: 0, action: 'approve' });
    assert.ok(callback);
    // No channel reply target: exercise the real approval path without generating a reply.
    await f.deliver({ type: 'block_actions', user: { id: 'UACTOR' }, actions: [{ action_id: `appr:${callback}` }] });
    assert.equal(dispatchApprovalStore.get(row.jti)?.status, 'approved'); assert.equal(f.store.get(f.id)?.selectedValue, null);
    assert.equal(f.calls.length, 0); assert.equal(submissions.length, 0);
});
for (const [name, override, accepted] of [
    ['undefined org sharing', { is_org_shared: undefined }, false],
    ['foreign context team', { context_team_id: 'T2' }, false],
    ['invalid supplied external sharing', { is_ext_shared: null }, false],
    ['matching context and omitted external flags', { context_team_id: 'T1' }, true],
] as const) test(`real callback DM proof: ${name}`, { timeout: 5000 }, async t => {
    const f = await fixture(t, override); await f.deliver(f.payload());
    assert.equal(f.store.get(f.id)?.selectedValue, accepted ? 'approve' : null);
    assert.equal(submissions.length, 0);
    if (!accepted) assert.deepEqual(f.calls, ['auth.test', 'conversations.info']);
});
test('disconnect removes choice availability and runtime admission while URL remains available', { timeout: 5000 }, async t => {
    const f = await fixture(t); const ready = () => f.client.getState() === 'connected' && isSlackInteractionReady();
    const catalog = () => slackToolCapabilities(TOKEN, slackActions, { kind: 'operator' }, f.actions, { fetchImpl: f.fetchImpl, inboundReady: ready() });
    const connected = await catalog(); assert.equal(connected.capabilities.find(c => c.operation === 'interaction.choice')?.available, true);
    f.client.stop(); assert.equal(ready(), false);
    const disconnected = await catalog(); assert.equal(disconnected.capabilities.find(c => c.operation === 'interaction.choice')?.reason, 'inbound_unavailable');
    assert.equal(disconnected.capabilities.find(c => c.operation === 'interaction.url')?.available, true);
    const runtime = new SlackActionRuntime({ getToken: () => TOKEN, store: f.actions, fetchImpl: f.fetchImpl, evidenceSource: 'fixture', inboundReady: ready });
    const count = f.calls.length;
    await assert.rejects(runtime.execute(slackAction('interaction.choice')!, { channel: 'D1', invocationId: 'new', text: 'Pick', choices: [{ label: 'Yes', value: 'yes' }] }, { kind: 'operator' }), /slack_interaction_inbound_unavailable/);
    assert.equal(f.calls.length, count);
});

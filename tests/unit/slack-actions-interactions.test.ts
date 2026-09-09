import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { interactionActions, consumeSlackInteractionCallback } from '../../src/slack/actions-interactions.ts';
import { SlackInteractionStore, configureSlackInteractionStore, isSlackInteractionReady } from '../../src/slack/interaction-store.ts';
import type { ActionContext, ActionVerification } from '../../src/slack/action-types.ts';
import type { SlackApiResult, SlackFetch } from '../../src/slack/api.ts';
import { slackCredentialKey } from '../../src/slack/tool-context.ts';

type FixtureOptions = { postFails?: boolean; readFails?: boolean; mismatch?: boolean; beforeDispatch?: () => void; operator?: boolean };
function fixture(t: { after(fn: () => void): void }, options: FixtureOptions = {}) {
    const db = new Database(':memory:'); const store = new SlackInteractionStore(db);
    const clock = { ms: 1800000000000 }; const credentials = { token: 'fixture-token' };
    configureSlackInteractionStore(store, { getToken: () => credentials.token, now: () => clock.ms });
    t.after(() => { configureSlackInteractionStore(null); db.close(); });
    const calls: string[] = []; let posted: Record<string, unknown> | undefined;
    let operation = 'interaction.choice';
    const result = (verification: ActionVerification, data?: unknown, resourceIds: string[] = []) => ({ ok: verification === 'verified', operation, verification, retryable: false as const, resourceIds, data });
    const ctx: ActionContext = {
        token: credentials.token, workspace: 'T1', actor: 'UACTOR', botUserId: 'UBOT', channel: 'D1', credentialKey: slackCredentialKey(credentials.token), operator: options.operator ?? false,
        async api<T>(method: string, body: Record<string, unknown>, beforeDispatch?: () => void | Promise<void>): Promise<SlackApiResult<T>> {
            options.beforeDispatch?.(); await beforeDispatch?.(); calls.push(method);
            if (method === 'chat.postMessage') {
                posted = structuredClone(body);
                if (operation === 'interaction.choice') assert.equal((db.prepare('SELECT count(*) AS n FROM slack_choice_interactions WHERE message_ts IS NULL').get() as { n: number }).n, 1);
                if (options.postFails) return { ok: false, error: 'timeout' };
                return { ok: true, data: { ts: '42.1', channel: 'D1' } as T };
            }
            assert.ok(['conversations.history', 'conversations.replies'].includes(method));
            if (operation === 'interaction.choice') assert.equal((db.prepare('SELECT message_ts FROM slack_choice_interactions').get() as { message_ts: string }).message_ts, '42.1');
            if (options.readFails) return { ok: false, error: 'missing_scope' };
            const blocks = structuredClone(posted!['blocks']) as Array<Record<string, unknown>>;
            for (const element of blocks[1]!['elements'] as Array<Record<string, unknown>>) {
                if (element['text']) (element['text'] as Record<string, unknown>)['emoji'] = true;
            }
            if (options.mismatch) (blocks[1]!['elements'] as Array<Record<string, unknown>>)[0]!['action_id'] = 'changed';
            return { ok: true, data: { messages: [{ ts: '42.1', user: 'UBOT', text: posted!['text'], blocks, ...(body['ts'] ? { thread_ts: body['ts'] } : {}) }] } as T };
        },
        remember() { throw new Error('use separate interaction store'); }, resource: () => undefined, resources: () => [], retire() {},
        checkCurrent() {}, now: () => clock.ms, async download() { throw new Error('unexpected download'); }, result,
        fail(error, status = 400, ids = []) { return { ...result('failed', undefined, ids), error, status }; },
    };
    async function run(op = 'interaction.choice', args: Record<string, unknown> = {}) {
        operation = op;
        const defaults = op === 'interaction.choice' ? { text: 'Choose', choices: [{ label: 'Approve', value: 'approve' }, { label: 'Reject', value: 'reject' }] } : op === 'interaction.url' ? { text: 'Open', buttons: [{ text: 'Docs', url: 'https://docs.slack.dev/' }] } : {};
        return interactionActions.find(a => a.operation === op)!.prepare({ operation: op, channel: 'D1', invocationId: 'inv1', ...defaults, ...args }).execute(ctx);
    }
    function row() { return store.get((db.prepare('SELECT id FROM slack_choice_interactions').get() as { id: string }).id)!; }
    function payload(style: 'buttons' | 'select' = 'buttons') {
        const r = row(); const o = r.options[0]!;
        return { type: 'block_actions', team: { id: 'T1' }, user: { id: 'UACTOR' }, container: { type: 'message', channel_id: 'D1', message_ts: '42.1', is_ephemeral: false },
            channel: { id: 'D1' }, message: { ts: '42.1' }, actions: [{ block_id: r.blockId, action_id: o.actionId, type: style === 'buttons' ? 'button' : 'static_select', ...(style === 'buttons' ? { value: o.wireValue } : { selected_option: { value: o.wireValue } }) }] };
    }
    const remote: string[] = [];
    const callbackFetch = (mutate?: (method: string, body: Record<string, unknown>) => Record<string, unknown> | undefined): SlackFetch => async (url, init) => {
        const method = String(url).split('/').at(-1)!; remote.push(method);
        const body = Object.fromEntries(new URLSearchParams(String(init?.body)));
        assert.equal((init?.headers as Record<string, string>)['Authorization'], 'Bearer fixture-token');
        const replies: Record<string, Record<string, unknown>> = {
            'auth.test': { ok: true, team_id: 'T1', user_id: 'UBOT' },
            'conversations.info': { ok: true, channel: { id: 'D1', is_im: true, user: 'UACTOR', is_org_shared: false } },
            'users.info': { ok: true, user: { id: 'UACTOR', team_id: 'T1', deleted: false } },
            'conversations.members': { ok: true, members: ['UACTOR', 'UBOT'], response_metadata: { next_cursor: '' } },
        };
        assert.ok(replies[method], `unexpected remote method ${method}`);
        return new Response(JSON.stringify(mutate?.(method, body) ?? replies[method]));
    };
    return { db, store, clock, credentials, ctx, calls, run, row, payload, remote, callbackFetch, posted: () => posted };
}

test('URL buttons permit operator, exact property readback tolerates Slack emoji defaults', async t => {
    const f = fixture(t, { operator: true });
    const receipt = await f.run('interaction.url');
    assert.equal(receipt.verification, 'verified');
    assert.deepEqual(f.calls, ['chat.postMessage', 'conversations.history']);
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM slack_choice_interactions').get() as { n: number }).n, 0);
});
for (const style of ['buttons', 'select'] as const) test(`${style} choice persists before post, binds ACK and consumes once across store reopening`, async t => {
    const f = fixture(t); const receipt = await f.run('interaction.choice', { style, threadTs: '40.1' });
    assert.equal(receipt.verification, 'verified'); assert.equal(f.row().messageTs, '42.1');
    assert.equal(f.row().expiresAt, f.clock.ms + 900000);
    const p = f.payload(style);
    assert.deepEqual(await consumeSlackInteractionCallback(p, f.credentials.token, f.callbackFetch()), { accepted: true });
    assert.equal(new SlackInteractionStore(f.db).get(f.row().id)?.selectedValue, 'approve');
    const count = f.remote.length;
    assert.deepEqual(await consumeSlackInteractionCallback(p, f.credentials.token, f.callbackFetch()), { accepted: false });
    assert.equal(f.remote.length, count);
    const status = await f.run('interaction.get', { interactionId: f.row().id });
    assert.equal((status.data as { selectedValue: string }).selectedValue, 'approve');
    assert.ok(f.remote.every(m => !m.startsWith('chat.')));
});
test('unconfigured store and operator choice fail before posting', async t => {
    const f = fixture(t); assert.equal(isSlackInteractionReady(), true);
    const action = interactionActions.find(a => a.operation === 'interaction.choice')!.prepare({ channel: 'D1', invocationId: 'i', text: 'Pick', choices: [{ label: 'One', value: 'one' }] });
    assert.equal((await action.execute({ ...f.ctx, operator: true })).error, 'slack_interaction_turn_required');
    configureSlackInteractionStore(null); assert.equal(isSlackInteractionReady(), false);
    assert.equal((await action.execute(f.ctx)).error, 'slack_interaction_unavailable'); assert.equal(f.calls.length, 0);
});
test('unknown post leaves persistent unbound choice unusable by callbacks', async t => {
    const f = fixture(t, { postFails: true }); assert.equal((await f.run()).verification, 'unknown');
    assert.equal(f.row().messageTs, null);
    assert.equal((await consumeSlackInteractionCallback(f.payload(), f.credentials.token, f.callbackFetch())).accepted, false);
    assert.equal(f.remote.length, 0);
});
test('readback failure and changed controls cannot become verified delivery', async t => {
    const f = fixture(t, { mismatch: true }); assert.equal((await f.run()).verification, 'failed'); assert.equal(f.calls.length, 2);
});
test('readback unavailable preserves bound ID without reposting', async t => {
    const f = fixture(t, { readFails: true }); const r = await f.run(); assert.equal(r.verification, 'unknown');
    assert.ok(r.resourceIds.includes('42.1')); assert.equal(f.row().messageTs, '42.1'); assert.equal(f.calls.filter(m => m === 'chat.postMessage').length, 1);
});
for (const [name, mutate] of Object.entries({
    actor: (p: Record<string, unknown>) => { p['user'] = { id: 'UOTHER' }; },
    workspace: (p: Record<string, unknown>) => { p['team'] = { id: 'T2' }; },
    channel: (p: Record<string, unknown>) => { (p['container'] as Record<string, unknown>)['channel_id'] = 'D2'; },
    message: (p: Record<string, unknown>) => { (p['container'] as Record<string, unknown>)['message_ts'] = '99.1'; },
    ephemeral: (p: Record<string, unknown>) => { (p['container'] as Record<string, unknown>)['is_ephemeral'] = true; },
    value: (p: Record<string, unknown>) => { (p['actions'] as Array<Record<string, unknown>>)[0]!['value'] = 'run_arbitrary_code'; },
    action: (p: Record<string, unknown>) => { (p['actions'] as Array<Record<string, unknown>>)[0]!['action_id'] = 'unknown'; },
    type: (p: Record<string, unknown>) => { p['type'] = 'view_submission'; },
    multiple: (p: Record<string, unknown>) => { (p['actions'] as unknown[]).push((p['actions'] as unknown[])[0]); },
})) test(`callback rejects mismatched ${name} before remote lookups`, async t => {
    const f = fixture(t); await f.run(); const p = f.payload(); mutate(p);
    assert.equal((await consumeSlackInteractionCallback(p, f.credentials.token, f.callbackFetch())).accepted, false);
    assert.equal(f.remote.length, 0); assert.equal(f.row().selectedValue, null);
});
test('current credential rotation rejects callback even with old captured token', async t => {
    const f = fixture(t); await f.run(); f.credentials.token = 'rotated';
    assert.equal((await consumeSlackInteractionCallback(f.payload(), 'fixture-token', f.callbackFetch())).accepted, false);
    assert.equal(f.remote.length, 0);
});
test('expiry at boundary and expiry during auth both reject without consumption', async t => {
    const f = fixture(t); await f.run('interaction.choice', { expiresInSeconds: 1 });
    const p = f.payload(); const fetcher = f.callbackFetch(method => { if (method === 'auth.test') { f.clock.ms += 1000; return { ok: true, team_id: 'T1', user_id: 'UBOT' }; } return { ok: false }; });
    assert.equal((await consumeSlackInteractionCallback(p, 'fixture-token', fetcher)).accepted, false);
    assert.equal(f.row().selectedValue, null); const count = f.remote.length;
    assert.equal((await consumeSlackInteractionCallback(p, 'fixture-token', f.callbackFetch())).accepted, false); assert.equal(f.remote.length, count);
});
test('token rotation during membership prevents CAS', async t => {
    const f = fixture(t); await f.run();
    const fetcher = f.callbackFetch(method => {
        if (method === 'conversations.members') { f.credentials.token = 'rotated'; return { ok: true, members: ['UACTOR', 'UBOT'], response_metadata: { next_cursor: '' } }; }
        return undefined;
    });
    assert.equal((await consumeSlackInteractionCallback(f.payload(), 'fixture-token', fetcher)).accepted, false); assert.equal(f.row().selectedValue, null);
});
for (const failure of ['auth', 'membership', 'rate']) test(`callback ${failure} failure cannot record a choice`, async t => {
    const f = fixture(t); await f.run();
    const fetcher = f.callbackFetch(method => {
        if (failure === 'auth' && method === 'auth.test') return { ok: true, team_id: 'T2', user_id: 'UBOT' };
        if (failure === 'rate') return { ok: false, error: 'ratelimited' };
        if (failure === 'membership' && method === 'conversations.members') return { ok: true, members: ['UBOT'], response_metadata: { next_cursor: '' } };
        return undefined;
    });
    assert.equal((await consumeSlackInteractionCallback(f.payload(), 'fixture-token', fetcher)).accepted, false); assert.equal(f.row().selectedValue, null);
    if (failure === 'rate') assert.equal(f.remote.length, 1);
});
test('concurrent duplicate callbacks have a single CAS winner', async t => {
    const f = fixture(t); await f.run();
    const results = await Promise.all([consumeSlackInteractionCallback(f.payload(), 'fixture-token', f.callbackFetch()), consumeSlackInteractionCallback(f.payload(), 'fixture-token', f.callbackFetch())]);
    assert.equal(results.filter(r => r.accepted).length, 1);
});
test('static select deselection is rejected and arbitrary callback fields are never stored', async t => {
    const f = fixture(t); await f.run('interaction.choice', { style: 'select' });
    const p = f.payload('select'); const nullSelection = { ...p, actions: [{ ...p.actions[0], selected_option: null }] };
    assert.equal((await consumeSlackInteractionCallback(nullSelection, 'fixture-token', f.callbackFetch())).accepted, false);
    assert.equal((await consumeSlackInteractionCallback({ ...p, response_url: 'https://attacker.invalid', code: 'evil', prompt: 'evil' }, 'fixture-token', f.callbackFetch())).accepted, true);
    assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM slack_choice_interactions').get()).includes('evil'));
});
test('choice get enforces actor/channel/workspace/bot/credential ownership', async t => {
    const f = fixture(t); await f.run(); const action = interactionActions.find(a => a.operation === 'interaction.get')!.prepare({ channel: 'D1', interactionId: f.row().id });
    for (const override of [{ actor: 'UOTHER' }, { workspace: 'T2' }, { botUserId: 'UOTHER' }, { credentialKey: 'old' }, { operator: true }]) assert.equal((await action.execute({ ...f.ctx, ...override })).verification, 'failed');
    const wrongChannel = interactionActions.find(a => a.operation === 'interaction.get')!.prepare({ channel: 'D2', interactionId: f.row().id });
    assert.equal((await wrongChannel.execute(f.ctx)).verification, 'failed');
});
test('strict schemas reject unsafe URLs, arbitrary user targeting, prompts, duplicates and bounds', () => {
    const url = interactionActions.find(a => a.operation === 'interaction.url')!;
    for (const value of ['http://example.com', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/\\evil']) assert.throws(() => url.prepare({ channel: 'D1', invocationId: 'i', text: 'Open', buttons: [{ text: 'Click', url: value }] }));
    const choice = interactionActions.find(a => a.operation === 'interaction.choice')!;
    const base = { channel: 'D1', invocationId: 'i', text: 'Pick', choices: [{ label: 'One', value: 'one' }] };
    for (const patch of [{ userId: 'UOTHER' }, { prompt: 'execute' }, { expiresInSeconds: 901 }, { choices: [] }, { choices: Array.from({ length: 11 }, (_, i) => ({ label: 'A', value: `v${i}` })) }, { choices: [base.choices[0], base.choices[0]] }]) assert.throws(() => choice.prepare({ ...base, ...patch }));
});
test('interaction store caps at 1000, reclaims only expired rows and disallows rebinding', async t => {
    const f = fixture(t); await f.run(); const initial = f.row();
    assert.equal(f.store.bind(initial.id, '99.1'), false);
    for (let i = 1; i < 1000; i++) f.store.create({ ...initial, id: i.toString(16).padStart(32, '0') }, f.clock.ms);
    assert.throws(() => f.store.create({ ...initial, id: 'f'.repeat(32) }, f.clock.ms), /slack_interaction_capacity/);
    f.clock.ms += 900000;
    f.store.create({ ...initial, id: 'f'.repeat(32), expiresAt: f.clock.ms + 1000 }, f.clock.ms);
    assert.equal(f.store.get(initial.id), undefined);
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM slack_choice_interactions').get() as { n: number }).n, 1);
});
test('choice expiring during pacing is persisted unbound and never dispatched', async t => {
    let expire = () => {};
    const f = fixture(t, { beforeDispatch: () => expire() });
    expire = () => { f.clock.ms += 1000; };
    const receipt = await f.run('interaction.choice', { expiresInSeconds: 1 });
    assert.equal(receipt.verification, 'unknown'); assert.equal(f.calls.length, 0); assert.equal(f.row().messageTs, null);
});
test('callback verifies current bot identity, rejects shared channel and incomplete DM membership', async t => {
    const f = fixture(t); await f.run();
    for (const [target, response] of [
        ['auth.test', { ok: true, team_id: 'T1', user_id: 'UOTHER' }],
        ['conversations.info', { ok: true, channel: { id: 'D1', is_im: true, user: 'UACTOR', is_ext_shared: true } }],
        ['conversations.members', { ok: true, members: ['UBOT', 'UACTOR'], response_metadata: { next_cursor: 'more' } }],
    ] as const) {
        assert.equal((await consumeSlackInteractionCallback(f.payload(), 'fixture-token', f.callbackFetch(method => method === target ? response : undefined))).accepted, false);
        assert.equal(f.row().selectedValue, null);
    }
});
test('store CAS checks allowed action/value binding and expiry independently of callback', async t => {
    const f = fixture(t); await f.run(); const row = f.row();
    assert.equal(f.store.consume(row, row.options[0]!.actionId, row.options[1]!.wireValue, f.clock.ms), false);
    assert.equal(f.store.consume(row, row.options[0]!.actionId, row.options[0]!.wireValue, row.expiresAt), false);
    assert.equal(f.store.consume({ ...row, actor: 'UOTHER' }, row.options[0]!.actionId, row.options[0]!.wireValue, f.clock.ms), false);
    assert.equal(f.row().selectedValue, null);
    assert.equal(f.store.consume(row, row.options[0]!.actionId, row.options[0]!.wireValue, f.clock.ms), true);
    assert.equal(f.store.consume(row, row.options[1]!.actionId, row.options[1]!.wireValue, f.clock.ms), false);
});
test('optional production evidence hook records only the CAS winner with captured safe identity', async t => {
    const f = fixture(t); await f.run();
    const evidence: Array<[string, string, string]> = [];
    configureSlackInteractionStore(f.store, { getToken: () => f.credentials.token, now: () => f.clock.ms,
        onVerified: (workspace, key, operation) => { evidence.push([workspace, key, operation]); },
    });
    const foreign = { ...f.payload(), user: { id: 'UOTHER' } };
    assert.equal((await consumeSlackInteractionCallback(foreign, 'fixture-token', f.callbackFetch())).accepted, false);
    assert.deepEqual(evidence, []);
    const results = await Promise.all([consumeSlackInteractionCallback(f.payload(), 'fixture-token', f.callbackFetch()), consumeSlackInteractionCallback(f.payload(), 'fixture-token', f.callbackFetch())]);
    assert.equal(results.filter(r => r.accepted).length, 1);
    assert.deepEqual(evidence, [['T1', slackCredentialKey('fixture-token'), 'interaction.choice']]);
    assert.equal((await consumeSlackInteractionCallback(f.payload(), 'fixture-token', f.callbackFetch())).accepted, false);
    assert.equal(evidence.length, 1);
});
test('evidence recorder failure never changes accepted choice or allows replay', async t => {
    const f = fixture(t); await f.run(); let records = 0;
    configureSlackInteractionStore(f.store, { getToken: () => f.credentials.token, now: () => f.clock.ms,
        onVerified: () => { records++; throw new Error('evidence persistence failed'); },
    });
    assert.equal((await consumeSlackInteractionCallback(f.payload(), 'fixture-token', f.callbackFetch())).accepted, true);
    assert.equal(f.row().selectedValue, 'approve');
    assert.equal((await consumeSlackInteractionCallback(f.payload(), 'fixture-token', f.callbackFetch())).accepted, false);
    assert.equal(records, 1);
});
test('URL delivery never requires inbound callback evidence; fixture config has no recorder', async t => {
    const f = fixture(t); const url = interactionActions.find(a => a.operation === 'interaction.url')!;
    assert.notEqual(url.requiresInbound, true);
    assert.equal((await f.run('interaction.url')).verification, 'verified');
    const block = (f.posted()!['blocks'] as Array<Record<string, unknown>>)[1]!;
    const element = (block['elements'] as Array<Record<string, unknown>>)[0]!;
    assert.ok(String(element['action_id']).startsWith('jaw_url_'));
    assert.equal((await consumeSlackInteractionCallback({ type: 'block_actions', actions: [{ block_id: block['block_id'], action_id: element['action_id'], type: 'button' }] }, 'fixture-token', f.callbackFetch())).accepted, false);
    assert.equal(f.remote.length, 0);
});

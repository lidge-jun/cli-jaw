import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SlackActionRuntime } from '../../src/slack/action-runtime.ts';
import { SlackActionStore } from '../../src/slack/action-store.ts';
import { SlackActionRateLimiter } from '../../src/slack/action-rate.ts';
import { resourceActions } from '../../src/slack/actions-resources.ts';
import { channelActions } from '../../src/slack/actions-channel.ts';
import { messageActions } from '../../src/slack/actions-message.ts';
import { configureRtsOutputStore, RtsOutputStore } from '../../src/slack/rts-output-store.ts';
import { resetVerifiedSlackWorkspace } from '../../src/slack/verified-workspace.ts';
import { reserveSlackToolGrant, activateSlackToolGrant, resolveSlackToolGrant, revokeSlackToolScope, slackCredentialKey } from '../../src/slack/tool-context.ts';
import type { SlackToolPrincipal } from '../../src/slack/tool-access.ts';

const TOKEN = 'privacy-fixture-token';
const PRIVATE = 'PRIVATE_LIST_CANARY';
const RTS = 'UNMARKED_RTS_CANARY';
const actions = [...resourceActions, ...channelActions, ...messageActions];

function fixture(channel: 'C1' | 'D1', privacy: 'ready' | 'unavailable' | 'unconfigured' = 'ready') {
    resetVerifiedSlackWorkspace();
    revokeSlackToolScope();
    const db = new Database(':memory:');
    configureRtsOutputStore(privacy === 'ready' ? new RtsOutputStore(db) : privacy === 'unavailable' ? null : undefined);
    const target = { channel: 'slack' as const, targetId: channel, targetKind: 'channel' as const,
        peerKind: channel === 'D1' ? 'direct' as const : 'channel' as const };
    assert.ok(reserveSlackToolGrant({ teamId: 'T1', actorId: 'U1', destination: target, credentialKey: slackCredentialKey(TOKEN) },
        { requestId: 'privacy-request', scope: 'default', chatSessionId: 'captured' }));
    const secret = activateSlackToolGrant('privacy-request', 'default', 'captured');
    assert.ok(secret);
    const grant = resolveSlackToolGrant(secret);
    assert.ok(grant);
    const principal: SlackToolPrincipal = { kind: 'turn', grant };
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async url => {
        const method = String(url).split('/').at(-1)!;
        calls.push(method);
        let data: Record<string, unknown>;
        if (method === 'auth.test') data = { team_id: 'T1', user_id: 'UBOT' };
        else if (method === 'conversations.info') data = { channel: channel === 'D1'
            ? { id: channel, is_im: true, is_org_shared: false, user: 'U1' }
            : { id: channel, is_shared: false, is_ext_shared: false, context_team_id: 'T1' } };
        else if (method === 'users.info') data = { user: { id: 'U1', team_id: 'T1' } };
        else if (method === 'conversations.members') data = { members: channel === 'D1' ? ['U1', 'UBOT'] : ['U1', 'UOTHER', 'UBOT'], response_metadata: { next_cursor: '' } };
        else if (method === 'files.info') data = { file: { id: 'F1', dm_mpdm_users_with_file_access: [{ user_id: 'U1', access: 'read' }] } };
        else if (method === 'slackLists.items.list') data = { items: [{ id: 'R1', list_id: 'F1', fields: [{ column_id: 'Col1', rich_text: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: PRIVATE }] }] }] }] }], response_metadata: { next_cursor: '' } };
        else if (method === 'pins.list') data = { items: [{ type: 'message', channel, message: { ts: '1.000000', user: 'UBOT', text: RTS } }] };
        else if (method === 'reactions.get') data = { type: 'message', message: { ts: '1.000000', user: 'UBOT', text: RTS,
            reactions: [{ name: 'eyes', count: 2, users: ['UBOT', 'U1'] }] } };
        else throw new Error(`Unexpected fake API method: ${method}`);
        return new Response(JSON.stringify({ ok: true, ...data }), { headers: { 'x-oauth-scopes': 'lists:read,files:read,users:read,pins:read,reactions:read' } });
    };
    let clock = 0;
    const runtime = new SlackActionRuntime({ getToken: () => TOKEN, store: new SlackActionStore(db), fetchImpl,
        rateLimiter: new SlackActionRateLimiter(() => clock += 10000), evidenceSource: 'fixture' });
    return {
        calls,
        run(operation: string, args: Record<string, unknown> = {}, actor: SlackToolPrincipal = principal) {
            const definition = actions.find(action => action.operation === operation);
            assert.ok(definition);
            return runtime.execute(definition, { operation, channel, ...args }, actor);
        },
        close() { revokeSlackToolScope(); resetVerifiedSlackWorkspace(); configureRtsOutputStore(undefined); db.close(); },
    };
}

for (const operation of ['list.read', 'canvas.read']) {
    test(`${operation}: real runtime denies requester-only file ACL in a wider conversation`, async t => {
        const f = fixture('C1'); t.after(() => f.close());
        await assert.rejects(f.run(operation, operation === 'list.read' ? { listId: 'F1' } : { canvasId: 'F1' }),
            { code: 'slack_resource_requester_dm_required' });
        assert.ok(f.calls.includes('conversations.members'));
        assert.equal(f.calls.includes('files.info'), false);
        assert.equal(f.calls.includes('slackLists.items.list'), false);
    });
}

test('list.read: verified requester/bot DM still returns requester-authorized fields', async t => {
    const f = fixture('D1'); t.after(() => f.close());
    const result = await f.run('list.read', { listId: 'F1' });
    assert.equal(result.verification, 'partial');
    assert.ok(JSON.stringify(result.data).includes(PRIVATE));
    assert.equal(f.calls.filter(method => method === 'conversations.info').length, 2);
});

test('list.read: explicit operator keeps independent resource authority', async t => {
    const f = fixture('C1'); t.after(() => f.close());
    const result = await f.run('list.read', { listId: 'F1' }, { kind: 'operator' });
    assert.ok(JSON.stringify(result.data).includes(PRIVATE));
});

for (const privacy of ['unavailable', 'unconfigured'] as const) {
    test(`real runtime masks unmarked pinned RTS content when privacy store is ${privacy}`, async t => {
        const f = fixture('C1', privacy); t.after(() => f.close());
        const result = await f.run('pin.list');
        assert.equal(result.verification, 'verified');
        assert.ok(!JSON.stringify(result).includes(RTS));
        assert.deepEqual((result.data as { items: unknown[] }).items,
            [{ ts: '1.000000', text: '[검색 응답 내용 제외]', contentExcluded: true }]);
        const reaction = await f.run('reaction.get', { ts: '1.000000' });
        assert.ok(!JSON.stringify(reaction).includes(RTS));
        assert.deepEqual(reaction.resourceIds, ['1.000000']);
        assert.deepEqual((reaction.data as { reactions: unknown[] }).reactions,
            [{ name: 'eyes', count: 2, ownBot: true, usersComplete: true }]);
    });
}

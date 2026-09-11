// Slack roster: channel membership and workspace directory, with the bounded
// cache -> users.list join -> small top-up strategy that replaces a naive
// users.info-per-member fan-out. Injected fetch, no DB access.


import test from 'node:test';
import assert from 'node:assert/strict';

import {
    fetchSlackChannelMembers,
    fetchSlackWorkspaceUsers,
    formatRosterForAgent,
} from '../../src/slack/roster.ts';
import { getCachedSlackIdentities, resetSlackIdentityCache } from '../../src/slack/identity.ts';
import { makeSlackFetch } from '../helpers/slack-fetch.mts';

const TOKEN = 'xoxb-not-a-real-token-000';
const TEAM = 'T0TEST';

const user = (id: string, name: string, over: Record<string, unknown> = {}) =>
    ({ id, profile: { display_name: name }, ...over });

test('channel members resolve to names through one users.list join', async () => {
    resetSlackIdentityCache();
    const { impl, calls } = makeSlackFetch({
        'conversations.members': [{ ok: true, members: ['U1', 'U2'] }],
        'users.list': [{ ok: true, members: [user('U1', '김병준'), user('U2', 'Ada')] }],
    });
    const result = await fetchSlackChannelMembers(TOKEN, 'C1', { teamId: TEAM, fetchImpl: impl });
    assert.ok(result.ok);
    assert.deepEqual(result.members.map(m => m.name), ['김병준', 'Ada']);
    // The point of the join: two members cost one list call, not two info calls.
    assert.equal(calls.filter(c => c.method === 'users.info').length, 0);
    assert.equal(calls.filter(c => c.method === 'users.list').length, 1);
});

test('members already in the identity cache cost no call at all', async () => {
    resetSlackIdentityCache();
    const warm = makeSlackFetch({
        'conversations.members': [{ ok: true, members: ['U1'] }],
        'users.list': [{ ok: true, members: [user('U1', 'Jun')] }],
    });
    await fetchSlackChannelMembers(TOKEN, 'C1', { teamId: TEAM, fetchImpl: warm.impl });

    const second = makeSlackFetch({ 'conversations.members': [{ ok: true, members: ['U1'] }] });
    const result = await fetchSlackChannelMembers(TOKEN, 'C1', { teamId: TEAM, fetchImpl: second.impl });
    assert.ok(result.ok);
    assert.equal(result.members[0]!.name, 'Jun');
    assert.equal(second.calls.filter(c => c.method === 'users.list').length, 0);
});

test('membership pagination follows the cursor', async () => {
    resetSlackIdentityCache();
    const { impl, calls } = makeSlackFetch({
        'conversations.members': [
            { ok: true, members: ['U1'], response_metadata: { next_cursor: 'c2' } },
            { ok: true, members: ['U2'] },
        ],
        'users.list': [{ ok: true, members: [user('U1', 'A'), user('U2', 'B')] }],
    });
    const result = await fetchSlackChannelMembers(TOKEN, 'C1', { teamId: TEAM, fetchImpl: impl });
    assert.ok(result.ok);
    assert.equal(result.members.length, 2);
    const memberCalls = calls.filter(c => c.method === 'conversations.members');
    assert.equal(memberCalls.length, 2);
    assert.equal(memberCalls[1]!.body['cursor'], 'c2');
});

test('membership walk stops at its page ceiling and says so', async () => {
    resetSlackIdentityCache();
    const { impl, calls } = makeSlackFetch({
        // Always another cursor: without a cap this walks forever.
        'conversations.members': [{ ok: true, members: ['U1'], response_metadata: { next_cursor: 'more' } }],
        'users.list': [{ ok: true, members: [user('U1', 'A')] }],
    });
    const result = await fetchSlackChannelMembers(TOKEN, 'C1', { teamId: TEAM, fetchImpl: impl });
    assert.ok(result.ok);
    assert.equal(result.hasMore, true);
    assert.equal(calls.filter(c => c.method === 'conversations.members').length, 5);
});

test('the users.list join is bounded even when the target never appears', async () => {
    resetSlackIdentityCache();
    const { impl, calls } = makeSlackFetch({
        'conversations.members': [{ ok: true, members: ['U_MISSING'] }],
        // Endless directory that never contains the member being looked for.
        'users.list': [{ ok: true, members: [user('UX', 'X')], response_metadata: { next_cursor: 'more' } }],
        'users.info': [{ ok: false, error: 'user_not_found' }],
    });
    const result = await fetchSlackChannelMembers(TOKEN, 'C1', { teamId: TEAM, fetchImpl: impl });
    assert.ok(result.ok);
    assert.equal(calls.filter(c => c.method === 'users.list').length, 3, 'list walk must be capped');
    assert.equal(result.members[0]!.name, 'U_MISSING', 'an unresolved member still appears, as its id');
});

test('an unresolved member is listed rather than silently dropped', async () => {
    resetSlackIdentityCache();
    const { impl } = makeSlackFetch({
        'conversations.members': [{ ok: true, members: ['U1', 'U_GHOST'] }],
        'users.list': [{ ok: true, members: [user('U1', 'Jun')] }],
        'users.info': [{ ok: false, error: 'user_not_found' }],
    });
    const result = await fetchSlackChannelMembers(TOKEN, 'C1', { teamId: TEAM, fetchImpl: impl });
    assert.ok(result.ok);
    assert.equal(result.members.length, 2, 'a roster that omits people is worse than one that admits it');
    assert.equal(result.members[1]!.name, 'U_GHOST');
});

test('missing_scope surfaces as operator prose, not a raw error code', async () => {
    resetSlackIdentityCache();
    const { impl } = makeSlackFetch({
        'conversations.members': [{ ok: false, error: 'missing_scope', needed: 'channels:read' }],
    });
    const result = await fetchSlackChannelMembers(TOKEN, 'C1', { teamId: TEAM, fetchImpl: impl });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error.includes('channels:read'), result.ok ? '' : result.error);
});

test('workspace users always send a limit', async () => {
    resetSlackIdentityCache();
    const { impl, calls } = makeSlackFetch({
        'users.list': [{ ok: true, members: [user('U1', 'Jun')] }],
        'team.info': [{ ok: true, team: { name: 'Acme' } }],
    });
    const result = await fetchSlackWorkspaceUsers(TOKEN, { teamId: TEAM, fetchImpl: impl });
    assert.ok(result.ok);
    // Slack marks limit optional, but omitting it can 500 on a large directory.
    assert.ok(calls.find(c => c.method === 'users.list')!.body['limit']);
    assert.equal(result.teamName, 'Acme');
});

test('bots and deactivated accounts are excluded unless asked for', async () => {
    resetSlackIdentityCache();
    const directory = [
        user('U1', 'Jun'),
        user('U2', 'Ledger', { is_bot: true }),
        user('U3', 'Gone', { deleted: true }),
    ];
    const plain = await fetchSlackWorkspaceUsers(TOKEN, {
        teamId: TEAM, fetchImpl: makeSlackFetch({ 'users.list': [{ ok: true, members: directory }] }).impl,
    });
    assert.ok(plain.ok);
    assert.deepEqual(plain.members.map(m => m.id), ['U1']);

    resetSlackIdentityCache();
    const full = await fetchSlackWorkspaceUsers(TOKEN, {
        teamId: TEAM, includeBots: true, includeDeleted: true,
        fetchImpl: makeSlackFetch({ 'users.list': [{ ok: true, members: directory }] }).impl,
    });
    assert.ok(full.ok);
    assert.deepEqual(full.members.map(m => m.id), ['U1', 'U2', 'U3']);
});

test('a workspace read warms the identity cache for later inbound messages', async () => {
    resetSlackIdentityCache();
    const { impl } = makeSlackFetch({ 'users.list': [{ ok: true, members: [user('U1', '김병준')] }] });
    await fetchSlackWorkspaceUsers(TOKEN, { teamId: TEAM, fetchImpl: impl });
    assert.equal(getCachedSlackIdentities(TEAM, ['U1']).get('U1')?.name, '김병준');
});

test('a missing team:read scope does not fail the roster', async () => {
    resetSlackIdentityCache();
    const { impl } = makeSlackFetch({
        'users.list': [{ ok: true, members: [user('U1', 'Jun')] }],
        'team.info': [{ ok: false, error: 'missing_scope', needed: 'team:read' }],
    });
    const result = await fetchSlackWorkspaceUsers(TOKEN, { teamId: TEAM, fetchImpl: impl });
    assert.ok(result.ok, 'the workspace name is optional garnish');
    assert.equal(result.teamName, undefined);
    assert.equal(result.members.length, 1);
});

test('the agent rendering keeps ids next to names', () => {
    const text = formatRosterForAgent({
        ok: true, hasMore: false, partial: false,
        members: [
            { id: 'U1', name: '김병준', isBot: false },
            { id: 'U2', name: 'Ledger', isBot: true },
        ],
    }, { channel: 'C1' });
    assert.ok(text.includes('#C1 멤버 2명'));
    // The agent needs the id for any follow-up call, so a name never replaces it.
    assert.ok(text.includes('- 김병준 (U1)'));
    assert.ok(text.includes('- Ledger (U2, 봇)'));
});

test('the rendering admits when it truncated or could not name everyone', () => {
    const text = formatRosterForAgent({
        ok: true, hasMore: true, partial: true,
        members: [{ id: 'U1', name: 'U1', isBot: false }],
    }, { channel: 'C1' });
    assert.ok(text.includes('페이지 상한'));
    assert.ok(text.includes('이름 해석 상한'));
});

import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceActions } from '../../src/slack/actions-resources.ts';
import type { ActionContext, ActionResult } from '../../src/slack/action-types.ts';
import type { ActionResource } from '../../src/slack/action-store.ts';
import type { SlackApiResult } from '../../src/slack/api.ts';

// Pure context fixture. No network, token lookup, SQLite, or live Slack evidence.
function fixture(operation: string, operator = false) {
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    const stored = new Map<string, ActionResource>();
    let current = true;
    const pacing: Record<string, () => void> = {};
    const file: Record<string, unknown> = { id: 'F1', title: 'Title', dm_mpdm_users_with_file_access: [{ user_id: 'UACTOR', access: 'write' }],
        list_metadata: { schema: [{ id: 'Col1', type: 'text' }, { id: 'Col2', type: 'number' }, { id: 'Col3', type: 'checkbox' }, { id: 'Col4', type: 'date' }, { id: 'Col5', type: 'user' }] } };
    const rich = [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Hello' }] }] }];
    const row: Record<string, unknown> = { id: 'Rec1', list_id: 'F1', updated_timestamp: '123', fields: [{ column_id: 'Col1', rich_text: rich }] };
    const replies: Record<string, () => SlackApiResult> = {
        'files.info': () => ({ ok: true, data: { file } }),
        'users.info': () => ({ ok: true, data: { user: { id: 'UACTOR', team_id: 'T1', deleted: false, is_bot: false, is_restricted: false, is_ultra_restricted: false } } }),
        'canvases.create': () => ({ ok: true, data: { canvas_id: 'F1' } }),
        'canvases.access.set': () => ({ ok: true }),
        'canvases.edit': () => ({ ok: true }),
        'slackLists.create': () => ({ ok: true, data: { list_id: 'F1' } }),
        'slackLists.access.set': () => ({ ok: true }),
        'slackLists.items.create': () => ({ ok: true, data: { item: row } }),
        'slackLists.items.update': () => ({ ok: true }),
        'slackLists.items.info': () => ({ ok: true, data: { record: row } }),
        'slackLists.items.list': () => ({ ok: true, data: { list: file, items: [row], response_metadata: { next_cursor: '' } } }),
    };
    const ctx: ActionContext = {
        token: 'context-fixture', workspace: 'T1', botUserId: 'UBOT', actor: operator ? 'operator' : 'UACTOR', channel: 'C1', credentialKey: 'fixture-key', operator,
        async api<T>(method: string, body: Record<string, unknown>, beforeDispatch?: () => void | Promise<void>) {
            ctx.checkCurrent(); assert.ok(resourceActions.find(a => a.operation === operation)!.methods.includes(method));
            pacing[method]?.();
            await beforeDispatch?.();
            ctx.checkCurrent();
            calls.push({ method, body }); return replies[method]!() as SlackApiResult<T>;
        },
        remember(kind, id, metadata = {}) { stored.set(`${kind}:${id}`, { workspace: ctx.workspace, botUserId: ctx.botUserId, actor: ctx.actor, channel: ctx.channel, credentialKey: ctx.credentialKey, kind, id, status: 'active', metadata }); },
        resource(kind, id) { return stored.get(`${kind}:${id}`); },
        resources(kind) { return [...stored.values()].filter(r => r.kind === kind); },
        retire(kind, id) { const r = stored.get(`${kind}:${id}`); if (r) r.status = 'retired'; },
        checkCurrent() { if (!current) throw new Error('fixture cancelled'); },
        now() { return 1800000000000; },
        async download() { return { content: 'Hello', contentType: 'text/markdown' }; },
        result(verification, data, resourceIds = []): ActionResult { return { ok: verification !== 'failed', operation, verification, retryable: false, resourceIds, data, partial: verification === 'partial' }; },
        fail(error, status = 400, resourceIds = []): ActionResult { return { ok: false, operation, verification: 'failed', retryable: false, resourceIds, error, status }; },
    };
    ctx.remember('list', 'F1'); ctx.remember('canvas', 'F1');
    const run = (args: Record<string, unknown> = {}) => resourceActions.find(a => a.operation === operation)!.prepare({ operation, channel: 'C1', invocationId: 'inv1', ...args }).execute(ctx);
    return { ctx, run, calls, file, row, replies, stored, pacing, cancel() { current = false; } };
}
const fields = [{ columnId: 'Col1', type: 'text', value: 'Hello' }];

test('all seven operations have static methods and strict schemas', () => {
    assert.equal(resourceActions.length, 7);
    for (const action of resourceActions) assert.throws(() => action.prepare({ channel: 'C1', invocationId: 'i', unexpected: true }));
    const edit = resourceActions.find(a => a.operation === 'canvas.edit')!;
    assert.throws(() => edit.prepare({ channel: 'C1', invocationId: 'i', canvasId: 'F1', mode: 'replace', markdown: 'x' }));
    assert.throws(() => edit.prepare({ channel: 'C1', invocationId: 'i', canvasId: 'F1', mode: 'append', sectionId: 'sec', markdown: 'x' }));
});
test('item.add uses initial_fields and item acknowledgement then info record proof', async () => {
    const f = fixture('list.item.add'); const result = await f.run({ listId: 'F1', fields });
    assert.equal(result.verification, 'verified');
    assert.deepEqual(result.resourceIds, ['F1', 'Rec1']);
    assert.deepEqual(f.calls.find(c => c.method === 'slackLists.items.create')?.body, { list_id: 'F1', initial_fields: [{ column_id: 'Col1', rich_text: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Hello' }] }] }] }] });
    assert.deepEqual(f.calls.find(c => c.method === 'slackLists.items.info')?.body, { list_id: 'F1', id: 'Rec1' });
    assert.ok(f.stored.has('list.item:Rec1'));
    assert.equal((result.data as Record<string, unknown>)['requesterView'], 'not_checked');
});
for (const alteration of ['no-ledger', 'actor', 'workspace', 'channel', 'bot', 'credential', 'retired', 'revoked', 'viewer-only', 'conflict']) {
    test(`requester write preflight denies ${alteration} before mutation`, async () => {
        const f = fixture('list.item.add'); const r = f.stored.get('list:F1')!;
        if (alteration === 'no-ledger') f.stored.delete('list:F1');
        if (alteration === 'actor') r.actor = 'UOTHER';
        if (alteration === 'workspace') r.workspace = 'TOTHER';
        if (alteration === 'channel') r.channel = 'COTHER';
        if (alteration === 'bot') r.botUserId = 'UOTHER';
        if (alteration === 'credential') r.credentialKey = 'other';
        if (alteration === 'retired') r.status = 'retired';
        if (alteration === 'revoked') f.file['dm_mpdm_users_with_file_access'] = [{ user_id: 'UACTOR', access: 'read' }];
        if (alteration === 'viewer-only') { delete f.file['dm_mpdm_users_with_file_access']; f.file['access'] = 'owner'; f.file['user'] = 'UACTOR'; f.file['editable'] = true; }
        if (alteration === 'conflict') f.file['dm_mpdm_users_with_file_access'] = [{ user_id: 'UACTOR', access: 'write' }, { user_id: 'UACTOR', access: 'read' }];
        const result = await f.run({ listId: 'F1', fields });
        assert.equal(result.ok, false); assert.equal(f.calls.some(c => c.method === 'slackLists.items.create'), false);
    });
}
test('workspace write requires explicit sharing and fresh non-guest membership', async () => {
    for (const guest of [false, true]) {
        const f = fixture('list.item.add'); delete f.file['dm_mpdm_users_with_file_access'];
        Object.assign(f.file, { org_or_workspace_access: 'write', source_team: 'T1', is_restricted_sharing_enabled: false });
        f.replies['users.info'] = () => ({ ok: true, data: { user: { id: 'UACTOR', team_id: 'T1', deleted: false, is_bot: false, is_restricted: guest, is_ultra_restricted: false } } });
        const result = await f.run({ listId: 'F1', fields }); assert.equal(result.verification === 'verified', !guest);
    }
});
test('update timestamp conflict and ACL revocation after pre-read prevent dispatch', async () => {
    const f = fixture('list.item.update');
    assert.equal((await f.run({ listId: 'F1', rowId: 'Rec1', fields, updatedTimestamp: '122' })).status, 409);
    f.replies['slackLists.items.info'] = () => { f.file['dm_mpdm_users_with_file_access'] = []; return { ok: true, data: { record: f.row } }; };
    assert.equal((await f.run({ listId: 'F1', rowId: 'Rec1', fields })).ok, false);
    assert.equal(f.calls.some(c => c.method === 'slackLists.items.update'), false);
});
test('typed update checks number checkbox date user and exact text, not fallback', async () => {
    const f = fixture('list.item.update');
    const typed = [...fields, { columnId: 'Col2', type: 'number', value: 2 }, { columnId: 'Col3', type: 'checkbox', value: true }, { columnId: 'Col4', type: 'date', value: '2026-09-09' }, { columnId: 'Col5', type: 'user', value: ['UACTOR'] }];
    f.row['fields'] = [{ column_id: 'Col1', rich_text: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Hello' }] }] }] }, { column_id: 'Col2', number: [2] }, { column_id: 'Col3', checkbox: [true] }, { column_id: 'Col4', date: ['2026-09-09'] }, { column_id: 'Col5', user: ['UACTOR'] }];
    assert.equal((await f.run({ listId: 'F1', rowId: 'Rec1', fields: typed })).verification, 'verified');
    (f.row['fields'] as Record<string, unknown>[])[1]!['number'] = [3];
    assert.equal((await f.run({ listId: 'F1', rowId: 'Rec1', fields: typed })).error, 'list_typed_content_mismatch');
    f.row['fields'] = [{ column_id: 'Col1', text: 'Hello' }];
    assert.equal((await f.run({ listId: 'F1', rowId: 'Rec1', fields })).error, 'list_typed_content_mismatch');
});
test('created row identity survives cancellation and failed readback without retry', async () => {
    for (const cancel of [false, true]) {
        const f = fixture('list.item.add');
        f.replies['slackLists.items.create'] = () => { if (cancel) f.cancel(); return { ok: true, data: { item: f.row } }; };
        f.replies['slackLists.items.info'] = () => ({ ok: false, error: 'ratelimited' });
        const result = await f.run({ listId: 'F1', fields });
        assert.notEqual(result.verification, 'verified'); assert.deepEqual(result.resourceIds, ['F1', 'Rec1']);
        assert.equal(result.retryable, false); assert.equal(f.calls.filter(c => c.method === 'slackLists.items.create').length, 1);
        assert.ok(f.stored.has('list.item:Rec1'));
    }
});
test('canvas creation and matching export remain partial', async () => {
    const f = fixture('canvas.create'); f.file['url_private'] = 'https://files.slack.com/fixture';
    const result = await f.run({ title: 'Title', markdown: 'Hello' });
    assert.equal(result.verification, 'partial'); assert.ok(f.stored.has('canvas:F1'));

});
test('canvas read missing URL and unsupported HTML do not become full body proof', async () => {
    const f = fixture('canvas.read'); assert.equal((await f.run({ canvasId: 'F1' })).verification, 'partial');
    f.file['url_private'] = 'https://files.slack.com/fixture'; f.ctx.download = async () => ({ content: '<p>Hello</p>', contentType: 'text/html' });
    assert.equal((await f.run({ canvasId: 'F1' })).verification, 'partial');
});
test('canvas replaceAll is explicit and requires current write', async () => {
    const f = fixture('canvas.edit');
    const result = await f.run({ canvasId: 'F1', mode: 'replace', replaceAll: true, markdown: 'Hello' });
    assert.equal(result.verification, 'partial');
    assert.deepEqual(f.calls.find(c => c.method === 'canvases.edit')?.body, { canvas_id: 'F1', changes: [{ operation: 'replace', document_content: { type: 'markdown', markdown: 'Hello' } }] });
});
test('list creation shares requester using user_ids and never claims actual view', async () => {
    const f = fixture('list.create'); const result = await f.run({ name: 'Title' });
    assert.equal(result.verification, 'partial');
    assert.deepEqual(f.calls.find(c => c.method === 'slackLists.access.set')?.body, { list_id: 'F1', access_level: 'write', user_ids: ['UACTOR'] });
});
test('list read returns bounded typed fields, explicit cursor, no raw vendor object', async () => {
    const f = fixture('list.read'); f.row['private_unknown'] = 'do not return';
    const result = await f.run({ listId: 'F1', limit: 1 });
    assert.equal(result.verification, 'partial'); assert.equal(JSON.stringify(result).includes('private_unknown'), false);
    assert.equal((result.data as Record<string, unknown>)['hasMore'], false);
    assert.match(JSON.stringify(result.data), /Hello/);
});

test('malformed cell schemas and duplicate columns refuse before any API', () => {
    const f = fixture('list.item.add');
    for (const bad of [[], [...fields, ...fields], [{ columnId: 'Col1', type: 'text', value: 'x', raw: true }], [{ columnId: 'Col2', type: 'number', value: Infinity }], [{ columnId: 'Col3', type: 'checkbox', value: 'true' }], [{ columnId: 'Col4', type: 'date', value: '2026-02-30' }], [{ columnId: 'Col5', type: 'user', value: ['U1', 'U1'] }]]) assert.throws(() => f.run({ listId: 'F1', fields: bad }));
    assert.equal(f.calls.length, 0);
});
test('foreign returned row never acquires an owned ledger entry', async () => {
    const f = fixture('list.item.add'); f.row['list_id'] = 'FOTHER';
    const result = await f.run({ listId: 'F1', fields });
    assert.equal(result.verification, 'unknown'); assert.equal(f.stored.has('list.item:Rec1'), false);
    assert.equal(f.calls.some(c => c.method === 'slackLists.items.info'), false);
});
test('schema mismatch and 429 access failures prevent mutation without retry', async () => {
    for (const rateLimit of [true, false]) {
        const f = fixture('list.item.add');
        if (rateLimit) f.replies['files.info'] = () => ({ ok: false, error: 'ratelimited', status: 429 });
        else f.file['list_metadata'] = { schema: [{ id: 'Col1', type: 'unsupported' }] };
        assert.equal((await f.run({ listId: 'F1', fields })).ok, false);
        assert.equal(f.calls.filter(c => c.method === 'files.info').length, 1);
        assert.equal(f.calls.some(c => c.method === 'slackLists.items.create'), false);
    }
});
test('read ACL revoked during download suppresses exported body', async () => {
    const f = fixture('canvas.read'); f.file['url_private'] = 'https://files.slack.com/fixture';
    f.ctx.download = async () => { f.file['dm_mpdm_users_with_file_access'] = []; return { content: 'PRIVATE BODY', contentType: 'text/markdown' }; };
    const result = await f.run({ canvasId: 'F1' });
    assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes('PRIVATE BODY'), false);
});
test('cancelled context has no API calls and no retry', async () => {
    const f = fixture('list.item.add'); f.cancel(); const result = await f.run({ listId: 'F1', fields });
    assert.notEqual(result.verification, 'verified'); assert.equal(result.retryable, false); assert.equal(f.calls.length, 0);
});
test('creation remembers ID before sharing throws', async () => {
    const f = fixture('list.create'); f.replies['slackLists.access.set'] = () => { throw new Error('fixture timeout'); };
    const result = await f.run({ name: 'Title' }); assert.equal(result.verification, 'unknown');
    assert.deepEqual(result.resourceIds, ['F1']); assert.ok(f.stored.has('list:F1'));
});

test('unexpected stored formatting and wrong row identity cannot satisfy item proof', async () => {
    const f = fixture('list.item.update');
    f.row['fields'] = [{ column_id: 'Col1', rich_text: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Hello', style: { bold: true } }] }] }] }];
    assert.equal((await f.run({ listId: 'F1', rowId: 'Rec1', fields })).error, 'list_typed_content_mismatch');
    f.row['id'] = 'RecOther';
    const before = f.calls.filter(c => c.method === 'slackLists.items.update').length;
    assert.equal((await f.run({ listId: 'F1', rowId: 'Rec1', fields })).error, 'list_row_unavailable');
    assert.equal(f.calls.filter(c => c.method === 'slackLists.items.update').length, before);
});
test('unknown read field stays partial, column IDs remain discoverable', async () => {
    const f = fixture('list.read'); f.row['fields'] = [{ column_id: 'Col1', unsupported_type: 'private' }];
    const result = await f.run({ listId: 'F1' });
    const data = result.data as Record<string, unknown>;
    assert.equal(result.verification, 'partial'); assert.equal(data['unsupported'], true);
    assert.match(JSON.stringify(data['columns']), /Col1/);
    assert.equal(JSON.stringify(result).includes('private'), false);
});


test('operator list creation never shares with a synthesized Slack user', async () => {
    const f = fixture('list.create', true);
    const result = await f.run({ name: 'Title' });
    assert.equal(result.verification, 'partial');
    assert.equal((result.data as Record<string, unknown>)['sharing'], 'not_requested');
    assert.equal(f.calls.some(c => c.method === 'slackLists.access.set' || c.method === 'users.info'), false);
    assert.equal(f.stored.get('list:F1')?.actor, 'operator');
});


for (const [operation, method, args] of [
    ['canvas.edit', 'canvases.edit', { canvasId: 'F1', mode: 'append', markdown: 'Hello' }],
    ['list.item.add', 'slackLists.items.create', { listId: 'F1', fields }],
    ['list.item.update', 'slackLists.items.update', { listId: 'F1', rowId: 'Rec1', fields }],
] as const) {
    test(`${operation} rechecks requester ACL after pacing before mutation`, async () => {
        const f = fixture(operation);
        f.pacing[method] = () => { f.file['dm_mpdm_users_with_file_access'] = [{ user_id: 'UACTOR', access: 'read' }]; };
        const result = await f.run(args);
        assert.notEqual(result.verification, 'verified');
        assert.equal(f.calls.some(c => c.method === method), false);
        assert.ok(f.calls.filter(c => c.method === 'files.info').length >= 2);
        assert.equal(result.retryable, false);
    });
}


test('DM canvas is standalone and shared only with the captured requester', async () => {
    const f = fixture('canvas.create'); Object.assign(f.ctx, { channel: 'D1' });
    const result = await f.run({ channel: 'D1', title: 'Title', markdown: 'Hello' });
    assert.equal(result.verification, 'partial'); assert.deepEqual(result.resourceIds, ['F1']);
    assert.equal((result.data as Record<string, unknown>)['sharing'], 'acknowledged');
    assert.deepEqual(f.calls[0]?.body, { title: 'Title', document_content: { type: 'markdown', markdown: 'Hello' } });
    assert.deepEqual(f.calls[1], { method: 'canvases.access.set', body: { canvas_id: 'F1', access_level: 'write', user_ids: ['UACTOR'] } });
    assert.equal(f.stored.get('canvas:F1')?.channel, 'D1');
    assert.ok(f.calls.filter(c => c.method === 'files.info').length >= 2);
    assert.equal((result.data as Record<string, unknown>)['requesterView'], 'not_checked');
});
for (const mode of ['denied', 'throw', 'read-only', 'cancel'] as const) {
    test(`DM canvas ${mode} preserves created ID without wider sharing or retry`, async () => {
        const f = fixture('canvas.create'); Object.assign(f.ctx, { channel: 'D1' });
        f.replies['canvases.access.set'] = () => {
            assert.ok(f.stored.has('canvas:F1'), 'remember before sharing await');
            if (mode === 'throw') throw new Error('fixture timeout');
            if (mode === 'cancel') f.cancel();
            if (mode === 'read-only') f.file['dm_mpdm_users_with_file_access'] = [{ user_id: 'UACTOR', access: 'read' }];
            return mode === 'denied' ? { ok: false, error: 'canvas_not_found' } : { ok: true };
        };
        const result = await f.run({ channel: 'D1', title: 'T', markdown: 'x' });
        assert.notEqual(result.verification, 'verified'); assert.deepEqual(result.resourceIds, ['F1']);
        assert.equal(f.calls.filter(c => c.method === 'canvases.create').length, 1);
        assert.equal(f.calls.filter(c => c.method === 'canvases.access.set').length, 1);
        assert.equal(f.calls.some(c => c.body['channel_ids'] !== undefined), false);
    });
}
test('free workspace denial is explicit and never retries with a new channel', async () => {
    const f = fixture('canvas.create'); Object.assign(f.ctx, { channel: 'D1' });
    f.replies['canvases.create'] = () => ({ ok: false, error: 'free_teams_cannot_create_standalone_canvases' });
    const result = await f.run({ channel: 'D1', title: 'T', markdown: 'x' });
    assert.equal(result.ok, false); assert.equal(result.error, 'free_teams_cannot_create_standalone_canvases');
    assert.equal(f.calls.length, 1); assert.deepEqual(result.resourceIds, []);
});
test('operator channel Canvas keeps channel context and does not invent requester UID', async () => {
    const f = fixture('canvas.create', true); const result = await f.run({ title: 'T', markdown: 'x' });
    assert.equal(result.verification, 'partial'); assert.equal(f.calls[0]?.body['channel_id'], 'C1');
    assert.equal(f.calls.some(c => c.method === 'canvases.access.set'), false);
});
test('foreign DM and operator DM without requester identity are refused before create', async () => {
    const f = fixture('canvas.create'); assert.equal((await f.run({ channel: 'DOTHER', title: 'T', markdown: 'x' })).ok, false); assert.equal(f.calls.length, 0);
    const g = fixture('canvas.create', true); Object.assign(g.ctx, { channel: 'D1' });
    assert.equal((await g.run({ channel: 'D1', title: 'T', markdown: 'x' })).ok, false); assert.equal(g.calls.length, 0);
});

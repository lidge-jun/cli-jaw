import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { channelActions } from '../../src/slack/actions-channel.ts';
import type { ActionContext, ActionResult } from '../../src/slack/action-types.ts';
import type { ActionResource } from '../../src/slack/action-store.ts';
import type { SlackApiResult } from '../../src/slack/api.ts';

// Pure context fixture: runtime supplies channel authorization and sensitive-response masking.
// No real Slack credentials, HTTP calls, membership claims, or persistence evidence.
function fixture(operation: string) {
    const definition = channelActions.find(action => action.operation === operation)!;
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    const resources = new Map<string, ActionResource>();
    const pin = { type: 'message', channel: 'C1', message: { ts: '123.456', text: 'Visible' } };
    const bookmark = { id: 'Bk1', channel_id: 'C1', title: 'Docs', link: 'https://example.com/docs', type: 'link', emoji: ':book:' };
    const replies: Record<string, SlackApiResult> = {
        'pins.add': { ok: true }, 'pins.remove': { ok: true },
        'pins.list': { ok: true, data: { items: operation === 'pin.remove' ? [] : [pin] } },
        'bookmarks.add': { ok: true, data: { bookmark } }, 'bookmarks.edit': { ok: true, data: { bookmark } }, 'bookmarks.remove': { ok: true },
        'bookmarks.list': { ok: true, data: { bookmarks: operation === 'bookmark.remove' ? [] : [bookmark] } },
    };
    const ctx: ActionContext = {
        token: 'context-fixture', workspace: 'T1', botUserId: 'UBOT', actor: 'UACTOR', channel: 'C1', credentialKey: 'fixture-key', operator: false,
        now: () => 1800000000000, checkCurrent() {},
        async api<T>(method: string, body: Record<string, unknown>, beforeDispatch?: () => void | Promise<void>) {
            assert.ok(definition.methods.includes(method), `undeclared method ${method}`);
            assert.equal(body['channel'] ?? body['channel_id'], ctx.channel);
            await beforeDispatch?.(); calls.push({ method, body });
            return replies[method] as SlackApiResult<T>;
        },
        remember(kind, id, metadata = {}) { resources.set(`${kind}:${id}`, { workspace: ctx.workspace, actor: ctx.actor, channel: ctx.channel, botUserId: ctx.botUserId, credentialKey: ctx.credentialKey, kind, id, status: 'active', metadata }); },
        resource(kind, id) { return resources.get(`${kind}:${id}`); },
        resources(kind) { return [...resources.values()].filter(r => r.kind === kind); },
        retire(kind, id) { const item = resources.get(`${kind}:${id}`); if (item) item.status = 'retired'; },
        async download() { throw new Error('unexpected fixture download'); },
        result(verification, data, resourceIds = []): ActionResult { return { ok: verification !== 'failed', operation, verification, retryable: false, resourceIds, data, partial: verification === 'partial' }; },
        fail(error, status = 400, resourceIds = []): ActionResult { return { ok: false, operation, verification: 'failed', retryable: false, resourceIds, error, status }; },
    };
    const run = (args: Record<string, unknown> = {}) => definition.prepare({ operation, channel: 'C1', ...(definition.mutates ? { invocationId: 'inv1' } : {}), ...args }).execute(ctx);
    return { ctx, run, calls, replies, pin, bookmark, resources };
}
const bookmarkInput = { title: 'Docs', link: 'https://example.com/docs' };

test('catalog exposes pin.list (not pin.get) and four bookmark operations', () => {
    assert.deepEqual(channelActions.map(a => a.operation).sort(), ['bookmark.add', 'bookmark.edit', 'bookmark.list', 'bookmark.remove', 'pin.add', 'pin.list', 'pin.remove']);
    for (const action of channelActions) {
        assert.throws(() => action.prepare({ channel: 'C1', invocationId: 'inv1', unexpected: 'x' }));
        assert.equal(action.mutates, !action.operation.endsWith('.list'));
    }
});
for (const op of ['pin.add', 'pin.remove', 'pin.list']) {
    test(`${op} proves exact timestamp state using pins.list`, async () => {
        const f = fixture(op); const result = await f.run(op === 'pin.list' ? {} : { ts: '123.456' });
        assert.equal(result.verification, 'verified'); assert.equal(result.retryable, false);
        assert.deepEqual(result.resourceIds, op === 'pin.list' ? [] : ['123.456']);
        if (op !== 'pin.list') assert.deepEqual(f.calls[0], { method: op === 'pin.add' ? 'pins.add' : 'pins.remove', body: { channel: 'C1', timestamp: '123.456' } });
        assert.deepEqual(f.calls.at(-1), { method: 'pins.list', body: { channel: 'C1' } });
    });
}
for (const [op, code] of [['pin.add', 'already_pinned'], ['pin.remove', 'not_pinned']]) {
    test(`${code} converges only after exact state readback`, async () => {
        const f = fixture(op!); f.replies[op === 'pin.add' ? 'pins.add' : 'pins.remove'] = { ok: false, error: code };
        assert.equal((await f.run({ ts: '123.456' })).verification, 'verified');
        f.replies['pins.list'] = { ok: true, data: { items: op === 'pin.add' ? [] : [f.pin] } };
        assert.equal((await f.run({ ts: '123.456' })).error, 'slack_pin_state_mismatch');
    });
}
test('pins partial excludes non-message items and preserves masked-content marker', async () => {
    const f = fixture('pin.list'); f.replies['pins.list'] = { ok: true, data: { items: [
        { type: 'message', channel: 'C1', message: { ts: '123.456', contentExcluded: true } }, { type: 'file', file: { id: 'F1', private: 'secret' } },
    ] } };
    const result = await f.run(); assert.equal(result.verification, 'partial');
    assert.deepEqual(result.data, { items: [{ ts: '123.456', text: '', contentExcluded: true }], scope: 'conversation' });
    assert.equal(JSON.stringify(result).includes('secret'), false);
});
for (const op of ['pin.add', 'pin.remove']) {
    test(`${op} read failure never proves desired state`, async () => {
        const f = fixture(op); f.replies['pins.list'] = { ok: false, error: 'missing_scope' };
        assert.equal((await f.run({ ts: '123.456' })).ok, false); assert.equal(f.calls.length, 2);
    });
}
test('pins rejects foreign channel and excessive readback', async () => {
    const f = fixture('pin.list'); f.pin.channel = 'COTHER'; assert.equal((await f.run()).error, 'slack_pins_target_mismatch');
    f.replies['pins.list'] = { ok: true, data: { items: Array(1001).fill(f.pin) } };
    assert.equal((await f.run()).error, 'slack_pins_readback_failed');
});
test('pin mutation error stops before readback and is never retried', async () => {
    const f = fixture('pin.add'); f.replies['pins.add'] = { ok: false, error: 'ratelimited', status: 429 };
    const result = await f.run({ ts: '123.456' }); assert.equal(result.status, 429); assert.equal(f.calls.length, 1);
});
test('pin strict input rejects bad timestamps, supplied actor and missing invocation', () => {
    const f = fixture('pin.add');
    for (const args of [{ ts: 'bad' }, { ts: '123.456', actor: 'UOTHER' }, { ts: '123.456', invocationId: undefined }]) assert.throws(() => f.run(args));
    assert.equal(f.calls.length, 0);
});
for (const op of ['bookmark.add', 'bookmark.edit', 'bookmark.remove', 'bookmark.list']) {
    test(`${op} uses channel-scoped readback and bounded projection`, async () => {
        const f = fixture(op);
        const result = await f.run(op === 'bookmark.add' ? bookmarkInput : op === 'bookmark.edit' ? { bookmarkId: 'Bk1', ...bookmarkInput } : op === 'bookmark.remove' ? { bookmarkId: 'Bk1' } : {});
        assert.equal(result.verification, 'verified'); assert.equal(result.retryable, false);
        if (op === 'bookmark.add') {
            assert.deepEqual(f.calls[0]?.body, { channel_id: 'C1', type: 'link', ...bookmarkInput });
            assert.equal(f.resources.get('bookmark:Bk1')?.actor, 'UACTOR');
        }
        assert.deepEqual(f.calls.at(-1), { method: 'bookmarks.list', body: { channel_id: 'C1' } });
    });
}
test('bookmark edits are channel-authorized, not creator-ledger restricted', async () => {
    const f = fixture('bookmark.edit');
    Object.assign(f.bookmark, { last_updated_by_user_id: 'UOTHER', app_id: 'AOTHER' });
    assert.equal(f.resources.size, 0);
    const result = await f.run({ bookmarkId: 'Bk1', title: 'Docs' });
    assert.equal(result.verification, 'verified');
    assert.equal(JSON.stringify(result).includes('UOTHER'), false);
});
test('bookmark validation refuses unsafe links, empty edit and unknown fields without API', () => {
    const f = fixture('bookmark.add');
    for (const link of ['http://example.com', 'https://user:pass@example.com', 'not a URL', 'https://example.com/xoxb-test-only-url-canary']) assert.throws(() => f.run({ title: 'Docs', link }));
    assert.throws(() => f.run({ ...bookmarkInput, title: 'x'.repeat(101) }));
    assert.throws(() => f.run({ ...bookmarkInput, owner: 'UOTHER' }));
    assert.throws(() => fixture('bookmark.edit').run({ bookmarkId: 'Bk1' }));
    assert.equal(f.calls.length, 0);
});
for (const key of ['title', 'link', 'emoji'] as const) {
    test(`bookmark edit checks exact ${key}`, async () => {
        const f = fixture('bookmark.edit');
        const result = await f.run({ bookmarkId: 'Bk1', [key]: key === 'link' ? 'https://example.com/other' : 'other' });
        assert.equal(result.error, 'slack_bookmark_content_mismatch'); assert.deepEqual(result.resourceIds, ['Bk1']);
    });
}
test('bookmark readback failure preserves created ID and cannot trigger repost', async () => {
    const f = fixture('bookmark.add'); f.replies['bookmarks.list'] = { ok: false, error: 'missing_scope' };
    const result = await f.run(bookmarkInput); assert.equal(result.ok, false); assert.deepEqual(result.resourceIds, ['Bk1']);
    assert.equal(f.calls.filter(c => c.method === 'bookmarks.add').length, 1); assert.ok(f.resources.has('bookmark:Bk1'));
});
test('bookmark removal needs successful absence; missing or present readback fails', async () => {
    const f = fixture('bookmark.remove'); f.replies['bookmarks.list'] = { ok: true, data: { bookmarks: [f.bookmark] } };
    assert.equal((await f.run({ bookmarkId: 'Bk1' })).error, 'slack_bookmark_still_present');
    f.replies['bookmarks.list'] = { ok: false, error: 'missing_scope' };
    assert.equal((await f.run({ bookmarkId: 'Bk1' })).error, 'slack_bookmark_readback_failed');
});
test('bookmark foreign-channel creation never enters owned ledger', async () => {
    const f = fixture('bookmark.add'); f.bookmark.channel_id = 'COTHER';
    assert.equal((await f.run(bookmarkInput)).error, 'slack_bookmark_id_unverified'); assert.equal(f.resources.size, 0);
});
test('bookmark list rejects wrong channel, missing IDs and overlimit', async () => {
    for (const bookmarks of [{}, [{ channel_id: 'C1' }], [{ id: 'Bk1', channel_id: 'COTHER' }], Array(101).fill({ id: 'Bk1', channel_id: 'C1' })]) {
        const f = fixture('bookmark.list'); f.replies['bookmarks.list'] = { ok: true, data: { bookmarks } };
        assert.equal((await f.run()).ok, false);
    }
});
// Regression oracles below intentionally assert the stronger delivery contract.
// Failures are reported to the source owner; this task does not change production code.
test('pin acknowledgement ID survives unavailable readback', async () => {
    const f = fixture('pin.add'); f.replies['pins.list'] = { ok: false, error: 'missing_scope' };
    assert.deepEqual((await f.run({ ts: '123.456' })).resourceIds, ['123.456']);
});
test('bookmark add does not verify a stored non-link object with matching title and URL', async () => {
    const f = fixture('bookmark.add'); f.bookmark.type = 'unsupported';
    assert.notEqual((await f.run(bookmarkInput)).verification, 'verified');
});
test('duplicate bookmark IDs cannot prove exact stored content', async () => {
    const f = fixture('bookmark.edit'); f.replies['bookmarks.list'] = { ok: true, data: { bookmarks: [f.bookmark, { ...f.bookmark, title: 'Wrong' }] } };
    assert.notEqual((await f.run({ bookmarkId: 'Bk1', title: 'Docs' })).verification, 'verified');
});

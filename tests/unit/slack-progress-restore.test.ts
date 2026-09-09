import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { loadLocales } from '../../src/core/i18n.ts';

loadLocales(fileURLToPath(new URL('../../public/locales/', import.meta.url)));
import { QueueNoticeStore } from '../../src/messaging/queue-notice-store.ts';
import { QueueNoticeRegistry } from '../../src/messaging/queue-notice.ts';
import { createSlackProgressRestorer } from '../../src/slack/progress-restore.ts';
import { createSlackNoticeTransport } from '../../src/slack/notice-transport.ts';
import type { SlackFetch } from '../../src/slack/api.ts';

const COPY = 'Previous progress tracking ended. The execution result is unconfirmed.';
const response = (error?: string) => new Response(JSON.stringify(error ? { ok: false, error } : { ok: true }));
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}
type Call = { method: string; body: Record<string, unknown>; signal: AbortSignal; authorization: string };
function fixture(t: TestContext, reply: (call: Call) => Promise<Response> = async () => response()) {
    const db = new Database(':memory:');
    const store = new QueueNoticeStore(db);
    const calls: Call[] = [];
    const registry = new QueueNoticeRegistry();
    const live = new Set<string>();
    let generation = 1;
    let token: string | null = 'fixture-old';
    let locale = 'en';
    let selectedStore: QueueNoticeStore | null = store;
    let errors = 0;
    let unregisters = 0;
    const fetchImpl: SlackFetch = async (input, init) => {
        assert.ok(registry.size >= 1, 'restore registered before first request');
        const call: Call = {
            method: String(input).split('/').at(-1)!,
            body: JSON.parse(String(init?.body)), signal: init!.signal!,
            authorization: new Headers(init?.headers).get('Authorization')!,
        };
        calls.push(call);
        return reply(call);
    };
    const restorer = createSlackProgressRestorer({
        getStore: () => selectedStore, getToken: () => token,
        getGeneration: () => generation, getLocale: () => locale,
        isLive: id => live.has(id), fetchImpl, onError: () => { errors++; },
        registerDrain: drain => {
            const remove = registry.add(drain);
            return () => { unregisters++; remove(); };
        },
    });
    function row(id: string, channel: 'slack' | 'telegram' = 'slack', attach = true) {
        store.reserve({ requestId: id, channel, target: {
            channel, targetId: 'C-fixture', targetKind: 'channel', peerKind: 'group',
        } });
        if (attach) store.attachMessageId(id, `ts-${id}`);
    }
    t.after(async () => { restorer.abort(); await registry.drain(100); db.close(); });
    return { store, row, calls, registry, restorer, live,
        generation: () => { generation++; }, token: (value: string | null) => { token = value; },
        locale: (value: string) => { locale = value; }, storeSelection: (value: QueueNoticeStore | null) => { selectedStore = value; },
        errors: () => errors, unregisters: () => unregisters };
}

for (const stopError of [undefined, 'message_not_in_streaming_state', 'stopped_by_user']) {
    test(`stop ${stopError ?? 'success'} then neutral edit closes direct and queued rows`, async t => {
        const f = fixture(t, async call => response(call.method === 'chat.stopStream' ? stopError : undefined));
        f.row('direct'); f.row('queued');
        await f.restorer.restore();
        assert.deepEqual(f.calls.map(c => c.method), ['chat.stopStream', 'chat.update', 'chat.stopStream', 'chat.update']);
        assert.deepEqual(f.calls.filter(c => c.method === 'chat.update').map(c => c.body), [
            { channel: 'C-fixture', ts: 'ts-direct', text: COPY, blocks: [] },
            { channel: 'C-fixture', ts: 'ts-queued', text: COPY, blocks: [] },
        ]);
        assert.equal(f.store.listRestorable().length, 0);
        assert.equal(f.registry.size, 0); assert.equal(f.unregisters(), 1);
    });
}
for (const stage of ['chat.stopStream', 'chat.update']) {
    test(`missing message at ${stage} closes row`, async t => {
        const f = fixture(t, async call => response(call.method === stage ? 'message_not_found' : undefined));
        f.row('old'); await f.restorer.restore();
        assert.equal(f.store.findByRequestId('old'), null);
        assert.equal(f.calls.length, stage === 'chat.stopStream' ? 1 : 2);
    });
}
for (const error of ['unknown_method', 'missing_scope', 'ratelimited', 'unexpected_error']) {
    test(`stop ${error} retains row without mutation`, async t => {
        const f = fixture(t, async () => response(error));
        f.row('old'); await f.restorer.restore();
        assert.deepEqual(f.calls.map(c => c.method), ['chat.stopStream']);
        assert.ok(f.store.findByRequestId('old')); assert.equal(f.errors(), 1);
    });
}
test('edit failure retains row and permits later explicit restoration', async t => {
    let fail = true;
    const f = fixture(t, async c => response(fail && c.method === 'chat.update' ? 'cant_update_message' : undefined));
    f.row('old'); await f.restorer.restore();
    assert.ok(f.store.findByRequestId('old'));
    fail = false; await f.restorer.restore();
    assert.equal(f.store.findByRequestId('old'), null);
});
test('live, unattached and foreign-channel rows are untouched', async t => {
    const f = fixture(t); f.row('live'); f.live.add('live'); f.row('reserved', 'slack', false); f.row('foreign', 'telegram');
    await f.restorer.restore();
    assert.equal(f.calls.length, 0);
    for (const id of ['live', 'reserved', 'foreign']) assert.ok(f.store.findByRequestId(id));
});
test('missing token or store keeps rows without HTTP', async t => {
    const f = fixture(t); f.row('old'); f.token(null); await f.restorer.restore();
    f.token('fixture'); f.storeSelection(null); await f.restorer.restore();
    assert.equal(f.calls.length, 0); assert.ok(f.store.findByRequestId('old'));
});
for (const action of ['abort', 'generation', 'drain'] as const) {
    test(`${action} during ignored-abort stop prevents late edit, next row and close`, async t => {
        const pending = deferred<Response>(); const entered = deferred<void>();
        const f = fixture(t, async () => { entered.resolve(); return pending.promise; });
        f.row('old'); f.row('next');
        const restoring = f.restorer.restore(); await entered.promise;
        if (action === 'abort') f.restorer.abort();
        if (action === 'generation') f.generation();
        const aborted = new Promise<void>(resolve => {
            if (f.calls[0]!.signal.aborted) resolve();
            else f.calls[0]!.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        const draining = action === 'drain' ? f.registry.drain(100) : Promise.resolve();
        if (action !== 'generation') await aborted;
        if (action !== 'generation') assert.equal(f.calls[0]!.signal.aborted, true);
        pending.resolve(response()); await restoring; await draining;
        assert.deepEqual(f.calls.map(c => c.method), ['chat.stopStream']);
        assert.equal(f.store.listRestorable().length, 2);
        assert.equal(f.registry.size, 0); assert.equal(f.unregisters(), 1);
    });
}
test('same generation shares exact promise and captured store/token/locale', async t => {
    const pending = deferred<Response>(); const entered = deferred<void>();
    const f = fixture(t, async c => {
        if (c.method === 'chat.stopStream') { entered.resolve(); return pending.promise; }
        return response();
    });
    f.row('old');
    const first = f.restorer.restore();
    assert.equal(f.restorer.restore(), first);
    await entered.promise;
    f.token('fixture-new'); f.locale('ko'); f.storeSelection(null);
    pending.resolve(response()); await first;
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every(c => c.authorization === 'Bearer fixture-old'));
    assert.equal(f.calls[1]!.body['text'], COPY);
    assert.deepEqual(f.calls[1]!.body['blocks'], []);
    assert.equal(f.store.findByRequestId('old'), null);
});
test('new generation aborts old operation and owns a distinct restore', async t => {
    const pending = deferred<Response>(); const entered = deferred<void>();
    let firstStop = true;
    const f = fixture(t, async c => {
        if (c.method === 'chat.stopStream' && firstStop) { firstStop = false; entered.resolve(); return pending.promise; }
        return response();
    });
    f.row('old'); const first = f.restorer.restore(); await entered.promise;
    f.generation();
    // Old registration is still present until its abort settles; use the same real registry.
    const second = f.restorer.restore(); assert.notEqual(first, second);
    pending.resolve(response()); await Promise.all([first, second]);
    assert.equal(f.calls[0]!.signal.aborted, true);
    assert.equal(f.store.findByRequestId('old'), null);
    assert.equal(f.calls.filter(c => c.method === 'chat.update').length, 1);
});
for (const stage of ['chat.stopStream', 'chat.update']) {
    test(`abort after late ${stage} success never closes row`, async t => {
        const f = fixture(t, async c => {
            if (c.method === stage) f.restorer.abort();
            return response();
        });
        f.row('old'); await f.restorer.restore();
        assert.ok(f.store.findByRequestId('old'));
        assert.equal(f.calls.length, stage === 'chat.stopStream' ? 1 : 2);
    });
}
for (const stopError of [undefined, 'message_not_in_streaming_state', 'stopped_by_user', 'message_not_found', 'unknown_method']) {
    test(`delete path stop ${stopError ?? 'success'}`, async () => {
        const methods: string[] = [];
        const fetchImpl: SlackFetch = async input => {
            const method = String(input).split('/').at(-1)!; methods.push(method);
            return response(method === 'chat.stopStream' ? stopError : undefined);
        };
        const transport = createSlackNoticeTransport('fixture', 'C-fixture', 'ts-old', { fetchImpl });
        if (stopError === 'unknown_method') await assert.rejects(transport.delete());
        else await transport.delete();
        assert.deepEqual(methods, stopError === 'message_not_found' || stopError === 'unknown_method'
            ? ['chat.stopStream'] : ['chat.stopStream', 'chat.delete']);
    });
}
test('delete checks cancellation after stop even with ignored abort', async () => {
    const controller = new AbortController(); const methods: string[] = [];
    const fetchImpl: SlackFetch = async input => {
        methods.push(String(input).split('/').at(-1)!); controller.abort(); return response();
    };
    await assert.rejects(createSlackNoticeTransport('fixture', 'C-fixture', 'ts', { fetchImpl }).delete(controller.signal));
    assert.deepEqual(methods, ['chat.stopStream']);
});
test('5000ms deadline retains row and blocks a late stop mutation even when fetch ignores abort', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred<Response>(); const entered = deferred<void>();
    const f = fixture(t, async () => { entered.resolve(); return pending.promise; });
    f.row('old'); const restoring = f.restorer.restore(); await entered.promise;
    t.mock.timers.tick(5000); await restoring;
    assert.equal(f.calls[0]!.signal.aborted, true); assert.ok(f.store.findByRequestId('old'));
    pending.resolve(response()); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(f.calls.map(c => c.method), ['chat.stopStream']);
});
test('generation change after edit response retains row and skips next record', async t => {
    const f = fixture(t, async c => {
        if (c.method === 'chat.update') f.generation();
        return response();
    });
    f.row('old'); f.row('next'); await f.restorer.restore();
    assert.equal(f.store.listRestorable().length, 2);
    assert.deepEqual(f.calls.map(c => c.method), ['chat.stopStream', 'chat.update']);
});
test('abort before scheduled work prevents all HTTP and unregisters', async t => {
    const f = fixture(t); f.row('old');
    const restoring = f.restorer.restore();
    assert.equal(f.registry.size, 1);
    f.restorer.abort(); await restoring;
    assert.equal(f.calls.length, 0); assert.equal(f.unregisters(), 1);
    assert.ok(f.store.findByRequestId('old'));
});
test('registered drain accepts an already-aborted shutdown signal before work', async () => {
    const controller = new AbortController(); controller.abort();
    let drained: Promise<void> | undefined;
    let unregistered = false;
    const restorer = createSlackProgressRestorer({
        getStore: () => null, getToken: () => 'fixture', getGeneration: () => 1,
        getLocale: () => 'en', isLive: () => false,
        registerDrain: drain => {
            drained = drain(controller.signal);
            return () => { unregistered = true; };
        },
        fetchImpl: async () => { throw new Error('unexpected HTTP'); },
    });
    await restorer.restore(); await drained; assert.equal(unregistered, true);
});
for (const error of ['message_not_found', 'cant_delete_message']) {
    test(`delete result ${error} after successful stop`, async () => {
        const methods: string[] = [];
        const fetchImpl: SlackFetch = async input => {
            const method = String(input).split('/').at(-1)!; methods.push(method);
            return response(method === 'chat.delete' ? error : undefined);
        };
        const deleting = createSlackNoticeTransport('fixture', 'C-fixture', 'ts', { fetchImpl }).delete();
        if (error === 'message_not_found') await deleting;
        else await assert.rejects(deleting);
        assert.deepEqual(methods, ['chat.stopStream', 'chat.delete']);
    });
}

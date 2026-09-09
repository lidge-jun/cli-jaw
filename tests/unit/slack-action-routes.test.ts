import '../setup/isolated-home.ts';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { registerSlackToolRoutes } from '../../src/routes/slack-tools.ts';
import { SlackActionRuntime } from '../../src/slack/action-runtime.ts';
import { SlackActionStore } from '../../src/slack/action-store.ts';
import { SlackActionRateLimiter } from '../../src/slack/action-rate.ts';
import { settings } from '../../src/core/config.ts';
import { resetVerifiedSlackWorkspace } from '../../src/slack/verified-workspace.ts';
import { configureRtsOutputStore } from '../../src/slack/rts-output-store.ts';

class Request extends EventEmitter {
    constructor(public body: Record<string, unknown>, public headers: Record<string, string>) { super(); }
}
class Response extends EventEmitter {
    statusCode = 200;
    writableEnded = false;
    body: any;
    status(code: number) { this.statusCode = code; return this; }
    json(body: unknown) { this.body = body; this.writableEnded = true; return this; }
}
type Handler = (req: Request, res: Response) => Promise<void>;
const TOKEN = 'route-fixture';
const operator = { 'x-jaw-slack-operator': 'operator-fixture' };
const read = { operation: 'reaction.get', channel: 'C1', ts: '1.000000' };

function fixture(t: TestContext) {
    resetVerifiedSlackWorkspace(); configureRtsOutputStore(null);
    const previous = settings.slack; const originalFetch = globalThis.fetch;
    settings.slack = { ...previous, enabled: true, botToken: TOKEN };
    const db = new Database(':memory:'); const store = new SlackActionStore(db);
    const calls: string[] = [];
    let intercept: ((method: string, init?: RequestInit) => Promise<ResponseType> | undefined) | undefined;
    type ResponseType = globalThis.Response;
    const fetchImpl: typeof fetch = async (url, init) => {
        const method = String(url).split('/').at(-1)!; calls.push(method);
        const overridden = intercept?.(method, init); if (overridden) return overridden;
        const data = method === 'auth.test' ? { team_id: 'T1', user_id: 'UBOT' }
            : method === 'reactions.get' ? { type: 'message', message: { ts: '1.000000', reactions: [] } }
            : method === 'chat.scheduleMessage' ? { scheduled_message_id: 'Q1' }
            : method === 'chat.scheduledMessages.list' ? { ok: false, error: 'missing_scope' } : null;
        assert.ok(data, `Unexpected provider method ${method}`);
        return new globalThis.Response(JSON.stringify({ ok: true, ...data }), { headers: { 'x-oauth-scopes': 'chat:write,reactions:read' } });
    };
    globalThis.fetch = fetchImpl;
    let clock = 0;
    const runtime = new SlackActionRuntime({ getToken: () => TOKEN, store, fetchImpl, evidenceSource: 'fixture',
        rateLimiter: new SlackActionRateLimiter(() => clock += 10000), now: () => 1800000000000 });
    const handlers = new Map<string, Handler>();
    const capture = (verb: string) => (path: string, ...fns: Handler[]) => { handlers.set(`${verb} ${path}`, fns.at(-1)!); };
    registerSlackToolRoutes({ post: capture('POST'), get: capture('GET') } as never,
        ((_req: unknown, _res: unknown, next: () => void) => next()) as never,
        value => value === 'operator-fixture', { runtime, store, inboundReady: () => false });
    t.after(() => { settings.slack = previous; globalThis.fetch = originalFetch; resetVerifiedSlackWorkspace(); configureRtsOutputStore(undefined); db.close(); });
    return { calls, runtime, handlers, intercept(fn: NonNullable<typeof intercept>) { intercept = fn; },
        async invoke(body = read, headers: Record<string, string> = operator, method = 'POST /api/slack/tools') {
            const req = new Request(body, headers); const res = new Response();
            await handlers.get(method)!(req, res); return { req, res };
        } };
}

test('tool execution requires Slack authority while the catalog reports unavailable authorization', async t => {
    const f = fixture(t); const execute = t.mock.method(f.runtime, 'execute');
    const denied = await f.invoke(read, { authorization: 'Bearer ordinary-instance-token' });
    assert.equal(denied.res.statusCode, 401); assert.equal(denied.res.body.retryable, false);
    assert.equal(execute.mock.callCount(), 0); assert.deepEqual(f.calls, []);
    const catalog = await f.invoke(read, { authorization: 'Bearer ordinary-instance-token' }, 'GET /api/slack/tools/capabilities');
    assert.equal(catalog.res.statusCode, 200);
    assert.equal(catalog.res.body.authorization.pooledNative, false);
    assert.ok(catalog.res.body.capabilities.every((entry: { available: boolean }) => !entry.available));
    assert.equal(execute.mock.callCount(), 0); assert.deepEqual(f.calls, ['auth.test']);
});

test('unknown proxy and extra method fields fail 400 before provider dispatch', async t => {
    const f = fixture(t);
    for (const body of [{ operation: 'chat.delete', method: 'chat.delete' }, { ...read, method: 'chat.delete' }]) {
        const { res } = await f.invoke(body as typeof read);
        assert.equal(res.statusCode, 400); assert.equal(res.body.retryable, false);
    }
    assert.deepEqual(f.calls, []);
});

test('real runtime read succeeds and authenticated capabilities distinguish fixture proof', async t => {
    const f = fixture(t); const { req, res } = await f.invoke();
    assert.equal(res.statusCode, 200); assert.equal(res.body.verification, 'verified');
    assert.deepEqual(res.body.resourceIds, ['1.000000']); assert.equal(res.body.retryable, false);
    assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0);
    const catalog = (await f.invoke(read, operator, 'GET /api/slack/tools/capabilities')).res;
    assert.equal(catalog.statusCode, 200);
    const entry = catalog.body.capabilities.find((item: any) => item.operation === 'reaction.get');
    assert.equal(entry.implemented, true); assert.equal(entry.granted, true); assert.equal(entry.available, true);
    assert.equal(entry.verified, false); assert.equal(entry.verifiedAt, null);
});

test('postwrite uncertainty preserves ID and failure status without automatic or invocation retry', async t => {
    const f = fixture(t);
    const body = { operation: 'schedule.create', channel: 'C1', invocationId: 'schedule1', postAt: 1800000120, text: 'fixture' };
    const first = (await f.invoke(body as typeof read)).res;
    assert.equal(first.statusCode, 502); assert.equal(first.body.verification, 'unknown');
    assert.deepEqual(first.body.resourceIds, ['Q1']); assert.equal(first.body.retryable, false);
    assert.equal(f.calls.filter(method => method === 'chat.scheduleMessage').length, 1);
    const second = (await f.invoke(body as typeof read)).res;
    assert.equal(second.statusCode, 409); assert.equal(second.body.retryable, false);
    assert.equal(f.calls.filter(method => method === 'chat.scheduleMessage').length, 1);
});

for (const event of ['aborted', 'close', 'finished-close'] as const) {
    test(`request lifecycle ${event} propagates cancellation only before response completion`, async t => {
        const f = fixture(t); const ready = Promise.withResolvers<AbortSignal>(); const release = Promise.withResolvers<globalThis.Response>();
        f.intercept((method, init) => {
            if (method !== 'reactions.get') return undefined;
            const signal = init?.signal; assert.ok(signal);
            ready.resolve(signal);
            signal.addEventListener('abort', () => release.reject(new DOMException('aborted', 'AbortError')), { once: true });
            return release.promise;
        });
        const req = new Request(read, operator); const res = new Response();
        const pending = f.handlers.get('POST /api/slack/tools')!(req, res);
        const signal = await ready.promise;
        if (event === 'aborted') req.emit('aborted');
        else { res.writableEnded = event === 'finished-close'; res.emit('close'); }
        assert.equal(signal.aborted, event !== 'finished-close');
        if (event === 'finished-close') release.resolve(new globalThis.Response(JSON.stringify({ ok: true, type: 'message', message: { ts: '1.000000', reactions: [] } })));
        await pending;
        assert.equal(res.body.ok, event === 'finished-close'); assert.equal(res.body.retryable, false);
        assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0);
        assert.equal(f.calls.filter(method => method === 'reactions.get').length, 1);
    });
}

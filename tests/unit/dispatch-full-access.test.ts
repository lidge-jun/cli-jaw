import '../setup/isolated-home.ts';
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const distributeUrl = new URL('../../src/orchestrator/distribute.ts', import.meta.url).href;
const pipelineUrl = new URL('../../src/orchestrator/pipeline.ts', import.meta.url).href;
const realDistribute = await import('../../src/orchestrator/distribute.js');
const realPipeline = await import('../../src/orchestrator/pipeline.js');

const runCalls: Array<{ ap: Record<string, unknown>; meta: Record<string, unknown> }> = [];
mock.module(distributeUrl, {
    namedExports: {
        ...realDistribute,
        runSingleAgent: async (ap: Record<string, unknown>, _emp: unknown, _worklog: unknown, _round: unknown, meta: Record<string, unknown> = {}) => {
            runCalls.push({ ap, meta });
            return { text: 'PASS', tools: [] };
        },
    },
});
mock.module(pipelineUrl, {
    namedExports: {
        ...realPipeline,
        drainPendingReplays: async () => 0,
    },
});

const { registerOrchestrateRoutes } = await import('../../src/routes/orchestrate.js');
const { initBossToken } = await import('../../src/core/boss-auth.js');
const { resolveOrcScope } = await import('../../src/orchestrator/scope.js');
const { setState, resetState } = await import('../../src/orchestrator/state-machine.js');
const { getWorkerSlot, claimWorker, cancelWorker } = await import('../../src/orchestrator/worker-registry.js');
const { setCurrentMainMeta } = await import('../../src/agent/spawn.js');

const bossToken = initBossToken();
const webScope = resolveOrcScope({ origin: 'web', workingDir: null });

type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;
const routes = new Map<string, Handler>();
const capture = (method: string) => (path: string, ...handlers: Handler[]) => {
    routes.set(method + ' ' + path, handlers[handlers.length - 1]!);
};
const fakeApp = {
    post: capture('POST'), get: capture('GET'), put: capture('PUT'),
    delete: capture('DELETE'), patch: capture('PATCH'),
};
let fullAccessCalls = 0;
function testIsFullAccess(req: { headers?: Record<string, unknown> }): boolean {
    fullAccessCalls += 1;
    return req?.headers?.['x-test-full'] === '1';
}
registerOrchestrateRoutes(
    fakeApp as never,
    ((_req: unknown, _res: unknown, next: () => void) => next()) as never,
    { isFullAccess: testIsFullAccess as never },
);
const twoArgRoutes = new Map<string, Handler>();
const capture2 = (method: string) => (path: string, ...handlers: Handler[]) => {
    twoArgRoutes.set(method + ' ' + path, handlers[handlers.length - 1]!);
};
registerOrchestrateRoutes({
    post: capture2('POST'), get: capture2('GET'), put: capture2('PUT'),
    delete: capture2('DELETE'), patch: capture2('PATCH'),
} as never, ((_req: unknown, _res: unknown, next: () => void) => next()) as never);

const dispatchHandler = routes.get('POST /api/orchestrate/dispatch');
const batchHandler = routes.get('POST /api/orchestrate/dispatch/batch');
const accessHandler = routes.get('GET /api/orchestrate/access');
const defaultDispatch = twoArgRoutes.get('POST /api/orchestrate/dispatch');

function fakeRes() {
    const state: { status: number; body: Record<string, unknown> | null } = { status: 200, body: null };
    const res = {
        status(code: number) { state.status = code; return res; },
        json(payload: Record<string, unknown>) { state.body = payload; return res; },
        on(_ev: string, _cb: () => void) { return res; },
        writableFinished: true,
        writableEnded: false,
    };
    return { res, state };
}

function req(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return { body, headers, ip: '127.0.0.1' };
}

test('two-arg registerOrchestrateRoutes stays non-full without a boss token', async () => {
    const { res, state } = fakeRes();
    await defaultDispatch!(req({ virtual: 'harness-alpha', task: 'x', wait: false }), res);
    assert.equal(state.status, 403);
    assert.equal(state.body?.error, 'dispatch_forbidden');
});

test('GET /access captures full-access once per HTTP request', async () => {
    assert.ok(accessHandler);
    fullAccessCalls = 0;
    const full = fakeRes();
    await accessHandler!(req({}, { 'x-test-full': '1' }), full.res);
    assert.equal(fullAccessCalls, 1);
    assert.equal(full.state.body?.fullAccess, true);
    assert.equal((full.state.body?.dispatch as { path?: string })?.path, 'direct');

    fullAccessCalls = 0;
    const none = fakeRes();
    await accessHandler!(req({}, {}), none.res);
    assert.equal(fullAccessCalls, 1);
    assert.equal(none.state.body?.fullAccess, false);
    assert.equal((none.state.body?.dispatch as { path?: string })?.path, 'approval');
});

test('GET access reports direct, boss, or approval from this request', async () => {
    assert.ok(accessHandler);
    const full = fakeRes();
    await accessHandler!(req({}, { 'x-test-full': '1' }), full.res);
    assert.equal(full.state.body?.fullAccess, true);
    assert.equal((full.state.body?.dispatch as { path?: string })?.path, 'direct');

    const boss = fakeRes();
    await accessHandler!(req({}, { 'x-jaw-boss-token': bossToken }), boss.res);
    assert.equal((boss.state.body?.dispatch as { path?: string })?.path, 'boss');

    const none = fakeRes();
    await accessHandler!(req({}, {}), none.res);
    assert.equal((none.state.body?.dispatch as { path?: string })?.path, 'approval');
});

test('full access without token dispatches independently', async () => {
    runCalls.length = 0;
    const { res, state } = fakeRes();
    await dispatchHandler!(req({
        virtual: 'harness-alpha',
        task: 'implement the slice',
        wait: false,
    }, { 'x-test-full': '1' }), res);
    assert.equal(state.status, 202);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(runCalls.length, 1);
    assert.equal(runCalls[0]?.meta.fullAccess, true);
    assert.equal(runCalls[0]?.ap.mutable, true);
    assert.match(String(runCalls[0]?.meta.scopeKey), /^local:/);
    assert.equal(runCalls[0]?.meta.origin, 'cli');
    const slot = getWorkerSlot(String((state.body?.worker as { agentId?: string })?.agentId));
    assert.equal(slot?.replayMeta?.target, undefined);
    assert.equal(slot?.replayMeta?.chatId, undefined);
    assert.equal(slot?.replayMeta?.fullAccess, true);
});

test('full plus valid boss token without selectors keeps legacy plan injection', async () => {
    runCalls.length = 0;
    setState('P', {
        originalPrompt: 'harness', workingDir: null, plan: 'keep this plan',
        workerResults: [], origin: 'web',
    }, webScope);
    try {
        const { res, state } = fakeRes();
        await dispatchHandler!(req({
            virtual: 'harness-alpha',
            task: 'continue the plan',
            wait: false,
        }, { 'x-test-full': '1', 'x-jaw-boss-token': bossToken }), res);
        assert.equal(state.status, 202);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(runCalls.length, 1);
        assert.match(String(runCalls[0]?.ap.task), /keep this plan/);
    } finally {
        resetState(webScope);
    }
});

test('partial selectors are 400 and do not spawn', async () => {
    runCalls.length = 0;
    const { res, state } = fakeRes();
    await dispatchHandler!(req({
        virtual: 'harness-alpha',
        task: 'x',
        scopeKey: 'default',
        wait: false,
    }, { 'x-test-full': '1' }), res);
    assert.equal(state.status, 400);
    assert.equal(state.body?.error, 'dispatch_context_invalid');
    assert.equal(runCalls.length, 0);
});

test('employee header without triple is dispatch_context_required', async () => {
    const { res, state } = fakeRes();
    await dispatchHandler!(req({
        virtual: 'harness-alpha',
        task: 'x',
        wait: false,
    }, { 'x-test-full': '1', 'x-jaw-employee-mode': '1' }), res);
    assert.equal(state.status, 400);
    assert.equal(state.body?.error, 'dispatch_context_required');
});

test('parent noDescendants is 403 before spawn', async () => {
    runCalls.length = 0;
    const parent = claimWorker({ id: 'emp-parent-nodesc', name: 'Parent' }, 'hold', {
        origin: 'cli', scopeId: 'default', chatSessionId: 'default', requestId: 'req',
        noDescendants: true, mutable: true,
    });
    try {
        const { res, state } = fakeRes();
        await dispatchHandler!(req({
            virtual: 'harness-alpha',
            task: 'child',
            wait: false,
            scopeKey: 'default',
            chatSessionId: 'default',
            requestId: parent.runId,
        }, { 'x-test-full': '1', 'x-jaw-employee-mode': '1' }), res);
        assert.equal(state.status, 403);
        assert.equal(state.body?.error, 'dispatch_no_descendants');
        assert.equal(runCalls.length, 0);
    } finally {
        cancelWorker(parent.agentId);
    }
});

test('batch uses the same validation and captured permissions', async () => {
    runCalls.length = 0;
    const { res, state } = fakeRes();
    await batchHandler!(req({
        wait: false,
        agents: [
            { virtual: 'harness-alpha', task: 'build one', parallel: true, affected_files: ['a.ts'] },
            { virtual: 'harness-beta', task: 'build two', parallel: true, affected_files: ['b.ts'] },
        ],
    }, { 'x-test-full': '1' }), res);
    assert.equal(state.status, 202);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(runCalls.length, 2);
    for (const call of runCalls) {
        assert.equal(call.meta.fullAccess, true);
        assert.equal(call.ap.mutable, true);
        assert.ok(call.meta.permissions === 'auto' || call.meta.permissions === undefined || typeof call.meta.permissions === 'string' || Array.isArray(call.meta.permissions));
    }
});

test('selected A defaults readonly unless --mutable, parent mutable false forbids override', async () => {
    runCalls.length = 0;
    setCurrentMainMeta('default', {
        origin: 'web', chatSessionId: 'default', requestId: 'req-a', permissions: 'safe',
    });
    setState('A', {
        originalPrompt: 'audit', workingDir: null, plan: 'plan',
        workerResults: [], origin: 'web',
    }, 'default');
    try {
        const omitted = fakeRes();
        await dispatchHandler!(req({
            virtual: 'harness-alpha', task: 'audit files', wait: false,
            scopeKey: 'default', chatSessionId: 'default', requestId: 'req-a',
        }, { 'x-test-full': '1' }), omitted.res);
        assert.equal(omitted.state.status, 202);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(runCalls.at(-1)?.ap.mutable, false);

        const parent = claimWorker({ id: 'emp-ro-parent', name: 'RoParent' }, 'hold', {
            origin: 'web', scopeId: 'default', chatSessionId: 'default', requestId: 'req-a',
            mutable: false, permissions: 'safe',
        });
        try {
            runCalls.length = 0;
            const denied = fakeRes();
            await dispatchHandler!(req({
                virtual: 'harness-beta', task: 'write anyway', wait: false, mutable: true,
                scopeKey: 'default', chatSessionId: 'default', requestId: parent.runId,
            }, { 'x-test-full': '1', 'x-jaw-employee-mode': '1' }), denied.res);
            assert.equal(denied.state.status, 400);
            assert.equal(denied.state.body?.error, 'dispatch_mutable_forbidden');
            assert.equal(runCalls.length, 0);
        } finally {
            cancelWorker(parent.agentId);
        }
    } finally {
        resetState('default');
        setCurrentMainMeta('default', null);
    }
});

test('forged body fullAccess does not authorize two-arg routes', async () => {
    const { res, state } = fakeRes();
    await defaultDispatch!(req({ virtual: 'harness-alpha', task: 'x', wait: false, fullAccess: true }), res);
    assert.equal(state.status, 403);
});

test('actual stored slot constraints drive nested child and prohibit scope widening', async () => {
    const parent = claimWorker({ id: 'nested-captured' }, 'parent', {
        scopeId: 'default', chatSessionId: 'default', origin: 'cli', mutable: false,
        permissions: ['read'], workingDir: '/captured', projectDirs: ['/captured'], scope: 'src',
    });
    try {
        const child = fakeRes();
        await dispatchHandler!(req({ virtual: 'nested-child', task: 'inspect', wait: true,
            scopeKey: 'default', chatSessionId: 'default', requestId: parent.runId,
        }, { 'x-test-full': '1', 'x-jaw-employee-mode': '1' }), child.res);
        assert.equal(child.state.status, 200);
        const call = runCalls.at(-1)!;
        assert.equal(call.ap.mutable, false);
        assert.equal(call.ap.allowDispatch, true);
        assert.equal(call.ap.scope, 'src');
        assert.deepEqual(call.meta.permissions, ['read']);
        assert.deepEqual(call.meta.projectDirs, ['/captured']);
        const slot = getWorkerSlot(String(call.meta.requestId))!;
        assert.equal(slot.replayMeta?.mutable, false);
        assert.equal(slot.replayMeta?.scope, 'src');
        assert.deepEqual(slot.replayMeta?.permissions, ['read']);
        const wider = fakeRes();
        await dispatchHandler!(req({ virtual: 'wider-child', task: 'inspect', scope: '.',
            scopeKey: 'default', chatSessionId: 'default', requestId: parent.runId,
        }, { 'x-test-full': '1' }), wider.res);
        assert.equal(wider.state.status, 400);
        assert.equal(wider.state.body?.error, 'dispatch_scope_forbidden');
    } finally { cancelWorker(parent.agentId); }
});

for (const path of ['/api/orchestrate/dispatch', '/api/orchestrate/dispatch/batch']) {
    test(`${path} captures callback once and validates before spawn`, async () => {
        fullAccessCalls = 0;
        const response = fakeRes();
        const item = { virtual: 'once', task: 'inspect', phase: 1 };
        await routes.get(`POST ${path}`)!(req(path.endsWith('/batch') ? { agents: [item] } : item,
            { 'x-test-full': '1' }), response.res);
        assert.equal(fullAccessCalls, 1);
        assert.equal(response.state.status, 200);
        assert.equal(runCalls.at(-1)?.ap.mutable, false);
    });
}

const { listChatSessions, getActiveChatSession } = await import('../../src/core/chat-sessions.ts');
const { settings: dispatchSettings } = await import('../../src/core/config.ts');
for (const batch of [false, true]) {
    for (const [label, bad] of Object.entries({
        task: { virtual: 'invalid', task: ' ' },
        policy: { virtual: 'invalid', task: 'inspect', mutable: 'false' },
        target: { agent: 'does-not-exist-fixture', task: 'inspect' },
        scope: { virtual: 'invalid', task: 'inspect', scope: '../outside', mutable: true },
    })) test(`${batch ? 'batch' : 'single'} rejected ${label} creates zero chats`, async () => {
        const before = listChatSessions().map(s => s.id);
        const active = getActiveChatSession();
        const callCount = runCalls.length;
        fullAccessCalls = 0;
        const response = fakeRes();
        await (batch ? batchHandler : dispatchHandler)!(req(batch
            ? { agents: [{ virtual: 'valid-first', task: 'inspect' }, bad] } : bad,
            { 'x-test-full': '1' }), response.res);
        assert.ok(response.state.status >= 400);
        assert.deepEqual(listChatSessions().map(s => s.id), before);
        assert.equal(getActiveChatSession(), active);
        assert.equal(runCalls.length, callCount);
        assert.equal(fullAccessCalls, 1);
    });
    test(`${batch ? 'batch' : 'single'} valid admission creates exactly one inactive captured chat`, async () => {
        const before = new Set(listChatSessions().map(s => s.id));
        const active = getActiveChatSession();
        const savedMulti = dispatchSettings.multiSession;
        const savedPermissions = dispatchSettings.permissions;
        dispatchSettings.multiSession = { ...savedMulti, enabled: false };
        dispatchSettings.permissions = ['read', 'edit'];
        try {
            const start = runCalls.length;
            const response = fakeRes();
            const item = { virtual: 'valid-admission', task: 'inspect' };
            fullAccessCalls = 0;
            await (batch ? batchHandler : dispatchHandler)!(req(batch ? { agents: [item, item] } : item,
                { 'x-test-full': '1' }), response.res);
            assert.equal(response.state.status, 200);
            const created = listChatSessions().filter(s => !before.has(s.id));
            assert.equal(created.length, 1);
            assert.equal(getActiveChatSession(), active);
            assert.equal(fullAccessCalls, 1);
            for (const call of runCalls.slice(start)) {
                assert.equal(call.meta.chatSessionId, created[0]!.id);
                assert.equal(call.meta.scopeKey, `local:${created[0]!.id}`);
                assert.deepEqual(call.meta.permissions, ['read', 'edit']);
            }
        } finally {
            dispatchSettings.multiSession = savedMulti;
            dispatchSettings.permissions = savedPermissions;
        }
    });
}

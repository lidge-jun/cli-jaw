import '../setup/isolated-home.ts';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { addBroadcastListener, removeBroadcastListener } from '../../src/core/bus.ts';
import { createQueueController } from '../../src/agent/spawn/queue.ts';
import { SessionLanes } from '../../src/orchestrator/session-lanes.ts';
import type { RemoteTarget } from '../../src/messaging/types.ts';

const calls: Array<{ prompt?: string; meta: Record<string, unknown> }> = [];
let rejectRun = false;
const pipeline = {
    orchestrate: async (prompt: string, meta: Record<string, unknown>) => {
        calls.push({ prompt, meta });
        if (rejectRun) throw new Error('fixture failure');
    },
    orchestrateContinue: async (meta: Record<string, unknown>) => { calls.push({ meta }); },
    orchestrateReset: async (meta: Record<string, unknown>) => { calls.push({ meta }); },
    isContinueIntent: (prompt: string) => prompt === '/continue',
    isResetIntent: (prompt: string) => prompt === '/reset',
    drainPendingReplays: async () => {},
};
mock.module('../../src/orchestrator/pipeline.js', { namedExports: pipeline });
const { steerAgent, activeMainProcesses } = await import('../../src/agent/spawn.js');
const target: RemoteTarget = { channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'C_FIXTURE', threadId: '100.001' };
const scope = 'slack-producer-scope';
const sessionId = 'slack-producer-session';
const requestId = 'slack-producer-request';
const remoteKey = 'slack:fixture:thread';

test.beforeEach(t => {
    calls.length = 0; rejectRun = false;
    assert.equal(activeMainProcesses.has(scope), false, 'idle fixture must never kill a process');
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected network'); });
    t.mock.method(process, 'kill', () => { throw new Error('unexpected PID signal'); });
});

for (const prompt of ['fixture prompt', '/continue', '/reset']) {
    test(`actual idle Slack restart preserves delivery ownership: ${prompt}`, async () => {
        const events: Array<{ type: string; data: Record<string, unknown> }> = [];
        const listener = (type: string, data: Record<string, unknown>) => { events.push({ type, data }); };
        addBroadcastListener(listener);
        try {
            assert.equal(await steerAgent(scope, prompt, 'slack', { cli: 'codex', chatSessionId: sessionId, target: { ...target }, chatId: target.targetId, requestId, remoteKey }), 'new-run');
        } finally { removeBroadcastListener(listener); }
        const started = events.filter(event => event.type === 'steer_started');
        assert.equal(started.length, 1);
        const expected = { origin: 'slack', scope, requestId, target, chatId: target.targetId, remoteKey, replyViaTarget: true, mode: 'restart' };
        assert.deepEqual(started[0]?.data, { prompt, ...expected, sessionId });
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0]?.meta, { ...expected, chatSessionId: sessionId, sessionId, _skipInsert: true });
    });
}

test('restart rejection retains captured Slack context after caller mutation', async () => {
    rejectRun = true;
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const supplied = { cli: 'codex', chatSessionId: sessionId, target: { ...target }, chatId: target.targetId, requestId, remoteKey };
    const listener = (type: string, data: Record<string, unknown>) => {
        events.push({ type, data });
        if (type === 'new_message') {
            supplied.target.targetId = 'WRONG'; supplied.requestId = 'WRONG'; supplied.remoteKey = 'WRONG';
        }
    };
    addBroadcastListener(listener);
    try {
        await steerAgent(scope, 'fixture prompt', 'slack', supplied);
        await new Promise<void>(resolve => setImmediate(resolve));
    } finally { removeBroadcastListener(listener); }
    const terminal = events.find(event => event.type === 'orchestrate_done')?.data;
    assert.deepEqual(terminal, { text: '[error] fixture failure', error: true, origin: 'slack', scope, sessionId,
        requestId, target, chatId: target.targetId, remoteKey, replyViaTarget: true, mode: 'restart' });
});

for (const source of ['web', 'telegram', 'slack']) {
    test(`restart leaves legacy metadata unchanged without a valid Slack target: ${source}`, async () => {
        const events: Record<string, unknown>[] = [];
        const listener = (type: string, data: Record<string, unknown>) => { if (type === 'steer_started') events.push(data); };
        addBroadcastListener(listener);
        try {
            await steerAgent(scope, 'fixture', source, { cli: 'codex', chatSessionId: sessionId,
                target: { ...target, channel: 'telegram' }, chatId: 'old-chat', requestId, remoteKey, replyViaTarget: true });
        } finally { removeBroadcastListener(listener); }
        assert.deepEqual(events, [{ prompt: 'fixture', origin: source, scope, requestId }]);
        assert.deepEqual(calls[0]?.meta, { origin: source, scope, chatSessionId: sessionId, requestId, _skipInsert: true });
    });
}

for (const multiSession of [false, true]) {
    test(`actual queue admission/start identities, multiSession=${multiSession}`, async () => {
        let busy = true;
        let activeSession = 'active-fixture';
        const persisted = new Map<string, string>();
        const events: Array<{ type: string; data: Record<string, unknown> }> = [];
        const controller = createQueueController({
            migrateQueuedMessagesV1ToV2() {}, isSpawnBusy: () => busy,
            hasBlockingWorkers: () => false, hasPendingWorkerReplays: () => false,
            insertMessage: { run() {} }, getActiveChatSession: () => activeSession,
            insertQueuedMessage: { run(id: string, payload: string) { persisted.set(id, payload); } },
            deleteQueuedMessage: { run(id: string) { persisted.delete(id); } },
            listQueuedMessages: { all: () => [] },
            broadcast(type, data) { events.push({ type, data }); },
            importPipeline: async () => pipeline,
            getWorkingDir: () => null, isMultiSessionEnabled: () => multiSession,
        }, new SessionLanes(() => 1));
        const id = controller.enqueueMessage('queued fixture', 'slack', { scope, chatSessionId: sessionId, target, requestId });
        assert.equal(persisted.has(id), true);
        const admission = events.find(event => event.type === 'queue_update')?.data;
        assert.equal(admission?.requestId, requestId);
        assert.equal(admission?.origin, 'slack');
        assert.equal(events.some(event => event.type === 'queued_run_started'), false);
        assert.equal(JSON.parse(persisted.get(id)!).chatSessionId, sessionId);
        activeSession = 'unrelated-chat-after-admission';
        busy = false;
        await controller.processQueue(multiSession ? scope : 'default');
        const starts = events.filter(event => event.type === 'queued_run_started');
        assert.equal(starts.length, 1);
        assert.deepEqual(starts[0]?.data, { requestId, origin: 'slack', scope: multiSession ? scope : 'default', target,
            sessionId });
        assert.equal(persisted.size, 0);
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.meta.chatSessionId, sessionId);
        busy = true;
        events.length = 0;
        controller.enqueueMessage('uncorrelated fixture', 'web');
        const uncorrelated = events.find(event => event.type === 'queue_update')?.data;
        assert.ok(uncorrelated);
        assert.equal(Object.hasOwn(uncorrelated, 'requestId'), false);
        assert.equal(Object.hasOwn(uncorrelated, 'origin'), false);
        assert.equal(events.some(event => event.type === 'queued_run_started'), false);
    });
}

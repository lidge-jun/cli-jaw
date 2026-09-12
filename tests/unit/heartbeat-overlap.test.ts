import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Overlap and cancellation, against the real scheduler.
 *
 * tests/unit/heartbeat-queue.test.ts cannot answer these questions: it
 * reimplements the queue locally and never imports the owner, so it stays green
 * however heartbeat.ts behaves.
 *
 * Two defects are pinned here. Neither is a concurrency bug — heartbeatBusy is
 * set synchronously before the first await, so two try-bodies cannot interleave.
 * They are about the same job being executed twice in sequence, and about a
 * teardown that did not actually stop anything.
 */

const collectUrl = new URL('../../src/orchestrator/collect.ts', import.meta.url).href;
const sendUrl = new URL('../../src/messaging/send.ts', import.meta.url).href;
const dbUrl = new URL('../../src/core/db.ts', import.meta.url).href;
const stateUrl = new URL('../../src/orchestrator/state-machine.ts', import.meta.url).href;
const spawnUrl = new URL('../../src/agent/spawn.ts', import.meta.url).href;
const registryUrl = new URL('../../src/orchestrator/worker-registry.ts', import.meta.url).href;

const [realSend, realDb, realState, realSpawn, realRegistry] = await Promise.all([
    import('../../src/messaging/send.js'),
    import('../../src/core/db.js'),
    import('../../src/orchestrator/state-machine.js'),
    import('../../src/agent/spawn.js'),
    import('../../src/orchestrator/worker-registry.js'),
]);

/** Flips to 'P' to simulate an active PABCD cycle deferring a main-runner tick. */
let pabcdState = 'IDLE';
/** Resolved by the test to release a run that is parked inside its try-body. */
let releaseRun: (() => void) | null = null;
let collectCalls = 0;
const sent: string[] = [];

mock.module(collectUrl, { namedExports: {
    orchestrateAndCollectData: async () => {
        collectCalls += 1;
        if (releaseRun) {
            await new Promise<void>(resolve => { releaseRun = resolve; });
        }
        return { text: 'status: ok\nsummary: tick complete', data: {} };
    },
    orchestrateAndCollect: async () => 'unused',
} });
mock.module(sendUrl, { namedExports: {
    ...realSend,
    sendChannelOutput: async (input: Record<string, any>) => { sent.push(String(input['text'])); return { ok: true }; },
} });
mock.module(dbUrl, { namedExports: {
    ...realDb,
    getEmployees: { all: () => [] },
    insertHeartbeatAnchor: { run: () => {} },
} });
mock.module(stateUrl, { namedExports: { ...realState, getState: () => pabcdState } });
mock.module(spawnUrl, { namedExports: { ...realSpawn, isAgentBusy: () => false, messageQueue: [] } });
mock.module(registryUrl, { namedExports: { ...realRegistry, hasPendingWorkerReplays: () => false } });

const { runHeartbeatJob, drainPending, stopHeartbeat, getHeartbeatRuntimeState } =
    await import('../../src/memory/heartbeat.js');
const { resolveHeartbeatBinding } = await import('../../src/memory/heartbeat-destination.js');

const destination = { channel: 'slack' as const, targetId: 'C_REPORTS', scope: 'channel_root' as const };
const JOB = { id: 'hb-1', name: 'status', runner: 'main', reportPolicy: 'always', destination };

function runJob(overrides: Record<string, unknown> = {}) {
    return runHeartbeatJob({ ...JOB, ...overrides }, {
        verifyDestination: async target => resolveHeartbeatBinding(target),
        reserveDestinationGrant: async () => () => {},
    });
}

function reset() {
    pabcdState = 'IDLE';
    releaseRun = null;
    collectCalls = 0;
    sent.length = 0;
    stopHeartbeat();
}

test('HB-OVL-001: a deferred tick is not replayed after a later tick already ran the job', async () => {
    // The sequence that produced two identical reports seconds apart: a tick is
    // deferred while PABCD is busy, a later tick runs the job directly once the
    // cycle ends, and the finishing run drains the copy the first tick left.
    reset();
    pabcdState = 'P';
    await runJob();
    assert.equal(collectCalls, 0, 'the deferred tick must not have executed');
    assert.equal(getHeartbeatRuntimeState().pending, 1, 'the deferred tick must be queued');

    pabcdState = 'IDLE';
    await runJob();

    assert.equal(collectCalls, 1, 'the job must run exactly once, not once per queued copy');
    assert.equal(sent.length, 1, 'exactly one report may be delivered');
    assert.equal(getHeartbeatRuntimeState().pending, 0, 'the satisfied queue entry must be gone');
});

test('HB-OVL-002: a job already running is skipped rather than queued', async () => {
    reset();
    releaseRun = () => {};
    const first = runJob();
    // The run is parked inside its try-body; a second arrival must not enqueue a
    // copy that the finishing run would then execute.
    await runJob();
    assert.equal(getHeartbeatRuntimeState().pending, 0, 'a running job must not be queued again');
    const release = releaseRun;
    releaseRun = null;
    release?.();
    await first;
    assert.equal(collectCalls, 1, 'the second arrival must not produce a second execution');
});

test('HB-OVL-003: stopHeartbeat drops queued work and the finishing run does not drain it', async () => {
    reset();
    pabcdState = 'P';
    await runJob();
    await runJob({ id: 'hb-2', name: 'other' });
    assert.equal(getHeartbeatRuntimeState().pending, 2, 'both ticks must be queued');

    stopHeartbeat();
    assert.equal(getHeartbeatRuntimeState().pending, 0, 'stop must drop the queue it would otherwise replay');

    pabcdState = 'IDLE';
    await drainPending();
    assert.equal(collectCalls, 0, 'a stopped schedule must not start work from any caller');
});

test('HB-OVL-004: drainPending is inert while the schedule is not armed', async () => {
    // drainPending is reachable from orchestrator/pipeline, routes/orchestrate,
    // cli/handlers-runtime and agent/spawn/queue, none of which know whether the
    // heartbeat is running.
    reset();
    pabcdState = 'P';
    await runJob();
    pabcdState = 'IDLE';
    await drainPending();
    assert.equal(collectCalls, 0, 'no timers are armed, so nothing may be dequeued');
});

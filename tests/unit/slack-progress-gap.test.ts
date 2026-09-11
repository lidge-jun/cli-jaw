import '../setup/isolated-home.ts';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { publish } from '../../src/core/event-bus.ts';
import { notifyRuntimeLiveness } from '../../src/agent/runtime/liveness.ts';

const phases: string[] = [];
const starts: Array<{ workflowResponse?: boolean }> = [];
let startGate: Promise<void> | undefined;
mock.module('../../src/slack/progress.ts', { namedExports: {
    startSlackProgress: async (_token: string, _target: unknown, _text: string, options: { workflowResponse?: boolean }) => {
        starts.push(options);
        if (startGate) await startGate;
        return {
        projectedTool() {}, runtimeLiveness() {}, phase(value: string) { phases.push(value); },
        async finish() {}, async ready() { return { mode: 'none', ts: null }; },
        abort() {}, terminalConfirmed() { return false; },
        };
    },
} });
const { createSlackProgressLifecycle } = await import('../../src/slack/progress-lifecycle.ts');
const identity = { requestId: 'example-request', runId: 'example-run', scope: 'example-scope', sessionId: 'example-session', origin: 'slack' as const };
const gap = (overrides: Record<string, unknown> = {}) => publish('agent', 'agent_runtime_gap', {
    runId: identity.runId, scope: identity.scope, sessionId: identity.sessionId, reason: 'projection_degraded', ...overrides,
});

test('a delayed card receives the latched gap before a newer delivering phase', async t => {
    phases.length = 0;
    let release!: () => void;
    startGate = new Promise<void>(resolve => { release = resolve; });
    const lifecycle = createSlackProgressLifecycle({ token: 'fake-token',
        target: { channel: 'slack', targetId: 'C0EXAMPLE', targetKind: 'channel', peerKind: 'channel' },
        requestId: identity.requestId, scope: identity.scope, sessionId: identity.sessionId, locale: 'en',
        registerTeardown: () => () => {}, onPosted() {}, onTerminalConfirmed() {},
    });
    t.after(async () => { release(); startGate = undefined; await lifecycle.finish('complete'); });
    lifecycle.start({ initialPhase: 'running' });
    notifyRuntimeLiveness(identity);
    gap(); lifecycle.phase('delivering');
    assert.deepEqual(phases, [], 'card creation is still held');
    release();
    await lifecycle.finish('complete', { bodyDelivered: true });
    assert.deepEqual(phases, ['unavailable', 'delivering']);
});

for (const beforeBinding of [false, true]) test(`scoped persistence gap is visible without activity or success evidence; beforeBinding=${beforeBinding}`, async t => {
    phases.length = 0;
    starts.length = 0;
    let activity = 0;
    const lifecycle = createSlackProgressLifecycle({ token: 'fake-token',
        target: { channel: 'slack', targetId: 'C0EXAMPLE', targetKind: 'channel', peerKind: 'channel' },
        requestId: identity.requestId, scope: identity.scope, sessionId: identity.sessionId, locale: 'en',
        workflowResponse: true,
        registerTeardown: () => () => {}, onPosted() {}, onTerminalConfirmed() {}, onActivity() { activity++; },
    });
    t.after(() => lifecycle.finish('complete'));
    lifecycle.start({ initialPhase: 'running' });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(starts[0]!.workflowResponse, true);
    for (const foreign of [{ runId: 'foreign-run' }, { scope: 'foreign-scope' }, { sessionId: 'foreign-session' }]) gap(foreign);
    assert.deepEqual(phases, []);
    if (beforeBinding) { gap(); assert.deepEqual(phases, []); }
    notifyRuntimeLiveness(identity);
    const baseline = activity;
    if (!beforeBinding) gap();
    assert.deepEqual(phases, ['unavailable']);
    assert.equal(activity, baseline, 'a persistence failure is not model/tool activity');
    gap(); assert.deepEqual(phases, ['unavailable'], 'loss notice is latched once');
    await lifecycle.finish('complete');
    gap(); assert.deepEqual(phases, ['unavailable'], 'closed owner ignores late gaps');
});

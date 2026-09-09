import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { addBroadcastListener, removeBroadcastListener, broadcast } from '../../src/core/bus.ts';
import { orchestrate } from '../../src/orchestrator/pipeline.ts';
import { subscribeRuntimeLiveness, notifyRuntimeLiveness } from '../../src/agent/runtime/liveness.ts';
import type { RuntimeLivenessIdentity } from '../../src/shared/runtime-contract.ts';
import type { spawnAgent } from '../../src/agent/spawn.ts';

type Options = NonNullable<Parameters<typeof spawnAgent>[1]>;
type Result = Awaited<ReturnType<typeof spawnAgent>['promise']> & { error?: boolean };
const identity: RuntimeLivenessIdentity = {
    runId: 'observer-run', sessionId: 'default', scope: 'observer-scope',
    origin: 'slack', requestId: 'observer-request',
};
const unsubscribers: Array<() => void> = [];
test.afterEach(() => { for (const unsubscribe of unsubscribers.splice(0)) unsubscribe(); });
function observe(callback: Parameters<typeof subscribeRuntimeLiveness>[0]) {
    const unsubscribe = subscribeRuntimeLiveness(callback);
    unsubscribers.push(unsubscribe);
    return unsubscribe;
}

// Only the provider spawn boundary is replaced. Real pipeline constructs the
// lifecycle, selects the resolved result and broadcasts its compatibility output.
async function run(activity: (options: Options) => void, meta: Record<string, unknown> = {},
    result: Result = { text: 'selected answer', code: 0 }) {
    await orchestrate('fixture task', {
        origin: identity.origin, scope: identity.scope, chatSessionId: identity.sessionId,
        requestId: identity.requestId, _skipInsert: true, _skipReplayDrain: true,
        ...meta,
        _spawnAgent: (_prompt: string, options: Options) => {
            activity(options);
            return { child: null, promise: Promise.resolve(result) };
        },
    });
}

test('queue-like pipeline without collector notifies with a frozen identity-only snapshot', async () => {
    const seen: Readonly<RuntimeLivenessIdentity>[] = [];
    observe(value => seen.push(value));
    const input = { ...identity, text: 'PRIVATE_RAW_CONTENT' };
    await run(options => {
        assert.ok(options.lifecycle?.onActivity);
        options.lifecycle.onActivity('native-runtime', input);
        input.runId = 'changed-after-notify';
    }, { _fromQueue: true });
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], identity);
    assert.ok(Object.isFrozen(seen[0]));
    assert.doesNotMatch(JSON.stringify(seen), /PRIVATE_RAW_CONTENT|changed-after-notify/);
});

test('pipeline composes original callback and isolates observer and callback throws', async () => {
    let callbacks = 0;
    const seen: Readonly<RuntimeLivenessIdentity>[] = [];
    observe(() => { throw new Error('observer failure'); });
    observe(value => seen.push(value));
    await run(options => {
        options.lifecycle?.onActivity?.('native-runtime', identity);
        options.lifecycle?.onActivity?.('native-runtime', identity);
    }, { _onRuntimeActivity: (value: RuntimeLivenessIdentity) => {
        assert.strictEqual(value, identity);
        callbacks++;
        throw new Error('collector failure');
    } });
    assert.equal(callbacks, 2);
    assert.equal(seen.length, 2);
});

test('pipeline ignores invalid/source-less identity and observer requires admission request ID', async () => {
    const seen: Readonly<RuntimeLivenessIdentity>[] = [];
    const collected: RuntimeLivenessIdentity[] = [];
    observe(value => seen.push(value));
    const { requestId: _requestId, ...withoutRequest } = identity;
    await run(options => {
        const activity = options.lifecycle?.onActivity;
        assert.ok(activity);
        activity('native-runtime');
        activity('stdout', identity);
        for (const key of ['runId', 'sessionId', 'scope', 'origin', 'requestId']) {
            activity('native-runtime', { ...identity, [key]: ' ' });
            // Malformed provider identity is intentionally injected at the lifecycle boundary.
            activity('native-runtime', { ...identity, [key]: 42 } as unknown as RuntimeLivenessIdentity);
        }
        activity('native-runtime', withoutRequest);
    }, { _onRuntimeActivity: (value: RuntimeLivenessIdentity) => collected.push(value) });
    assert.deepEqual(seen, []);
    assert.deepEqual(collected, [withoutRequest], 'collector retains its optional-request contract');
});

test('observer bounds every identity field without truncation or extra content', () => {
    const seen: Readonly<RuntimeLivenessIdentity>[] = [];
    observe(value => seen.push(value));
    for (const key of ['runId', 'sessionId', 'scope', 'origin', 'requestId']) {
        notifyRuntimeLiveness({ ...identity, [key]: 'x'.repeat(1025) });
    }
    assert.deepEqual(seen, []);
    notifyRuntimeLiveness({ ...identity, scope: 'x'.repeat(1024) });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.scope.length, 1024);
});

test('unsubscribe is idempotent and removes future pipeline notifications', async () => {
    let count = 0;
    const unsubscribe = observe(() => { count++; });
    await run(options => {
        options.lifecycle?.onActivity?.('native-runtime', identity);
        unsubscribe();
        unsubscribe();
        options.lifecycle?.onActivity?.('native-runtime', identity);
    });
    assert.equal(count, 1);
});

test('worker-result pipeline still excludes lifecycle and collector callbacks', async () => {
    let count = 0;
    observe(() => { count++; });
    await run(options => assert.equal(options.lifecycle, undefined), {
        _workerResult: true, _onRuntimeActivity: () => { count++; },
    });
    assert.equal(count, 0);
});

for (const scenario of [
    { name: 'actual code-only failure', intermediateError: false, failed: true },
    { name: 'explicit final failure', error: true, intermediateError: false, failed: true },
    { name: 'selected success', error: false, intermediateError: false, failed: false },
    { name: 'intermediate error recovered to success', error: false, intermediateError: true, failed: false },
    { name: 'selected success without error field', intermediateError: false, failed: false },
]) {
    test(`pipeline final failure provenance: ${scenario.name}`, async () => {
        const events: Array<{ type: string; data: Record<string, unknown> }> = [];
        const listener = (type: string, data: Record<string, unknown>) => events.push({ type, data });
        addBroadcastListener(listener);
        try {
            await run(() => {
                if (scenario.intermediateError) broadcast('agent_done', { ...identity, error: true, text: 'retry failure' });
            }, {}, { text: 'selected answer', code: scenario.failed ? 1 : 0,
                ...('error' in scenario ? { error: scenario.error } : {}),
            });
        } finally { removeBroadcastListener(listener); }
        const terminals = events.filter(event => event.type === 'orchestrate_done');
        assert.equal(terminals.length, 1);
        const payload = terminals[0]!.data;
        assert.equal(payload['text'], 'selected answer');
        assert.equal('executionFailed' in payload, scenario.failed);
        if (scenario.failed) assert.equal(payload['executionFailed'], true);
        assert.equal('runtimeStatus' in payload, false);
        assert.equal('runtimeFinality' in payload, false);
        assert.equal(events.some(event => event.type === 'agent_done' && event.data['error'] === true), scenario.intermediateError);
    });
}

for (const scenario of [
    { name: 'interrupted beats failure and code', result: { executionInterrupted: true, executionFailed: true, code: 1 }, interrupted: true, failed: false },
    { name: 'explicit failure with coerced code zero', result: { executionFailed: true, code: 0 }, interrupted: false, failed: true },
    { name: 'native done ignores physical failure and interruption', result: { runtimeOutcome: { status: 'done' as const, finalText: 'selected answer', partialText: '' }, executionInterrupted: true, executionFailed: true, error: true, code: 9 }, interrupted: false, failed: false },
    { name: 'noninteger code is not exit proof', result: { code: 1.5 }, interrupted: false, failed: false },
    { name: 'nonfinite code is not exit proof', result: { code: Infinity }, interrupted: false, failed: false },
]) {
    test(`pipeline selected provenance: ${scenario.name}`, async () => {
        const terminals: Record<string, unknown>[] = [];
        const listener = (type: string, data: Record<string, unknown>) => { if (type === 'orchestrate_done') terminals.push(data); };
        addBroadcastListener(listener);
        try { await run(() => {}, {}, { text: 'selected answer', ...scenario.result }); }
        finally { removeBroadcastListener(listener); }
        assert.equal(terminals.length, 1);
        assert.equal(terminals[0]?.executionInterrupted, scenario.interrupted ? true : undefined);
        assert.equal(terminals[0]?.executionFailed, scenario.failed ? true : undefined);
        if ('runtimeOutcome' in scenario.result) assert.equal(terminals[0]?.runtimeStatus, 'done');
    });
}

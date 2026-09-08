import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

let resolved: Array<() => Promise<{ models: string[]; entries: Array<{ id: string; efforts: string[]; defaultEffort?: string }>; source: 'opencodex' | 'static' }>> = [];
let calls = 0;
mock.module('../../src/cli/opencodex-models.js', {
    namedExports: {
        resolveOpenCodexCodexModelsDetailed: async () => {
            const next = resolved[Math.min(calls, resolved.length - 1)];
            calls += 1;
            if (!next) throw new Error('no fixture');
            return next();
        },
    },
});
const { primeCodexLiveModels, readCodexLiveModels, resetCodexLiveModelsForTest } =
    await import('../../src/code-mode/providers/live-models.ts');

const entry = (id: string, efforts: string[] = ['low', 'high']) => ({ id, efforts });
const live = (ids: string[]) => async () => ({ models: ids, entries: ids.map(id => entry(id)), source: 'opencodex' as const });
const staticResult = async () => ({ models: ['gpt-5.5'], entries: [entry('gpt-5.5')], source: 'static' as const });
const boom = async () => { throw new Error('proxy unreachable'); };

function scenario(steps: typeof resolved) {
    resolved = steps;
    calls = 0;
    resetCodexLiveModelsForTest();
}

test('a successful probe becomes the readable snapshot with a per-model effort map', async () => {
    scenario([live(['gpt-6-astra', 'anthropic/claude-opus-5'])]);
    const snapshot = await primeCodexLiveModels();
    assert.equal(snapshot?.source, 'opencodex');
    assert.deepEqual(snapshot?.models, ['gpt-6-astra', 'anthropic/claude-opus-5']);
    assert.deepEqual(snapshot?.efforts, ['low', 'high'], 'the union preserves first-seen order without duplicates');
    assert.deepEqual(snapshot?.effortsByModel['gpt-6-astra'], ['low', 'high']);
});

test('a failing probe is not retried on every read', async () => {
    scenario([boom]);
    await primeCodexLiveModels();
    assert.equal(calls, 1);
    // A stale-and-empty snapshot used to restart the probe on each catalog read.
    for (let i = 0; i < 20; i += 1) assert.equal(readCodexLiveModels(), null);
    assert.equal(calls, 1, 'reads after a failure must respect the retry floor');
});

test('a degraded probe never replaces a live snapshot', async () => {
    scenario([live(['gpt-6-astra']), staticResult]);
    await primeCodexLiveModels();
    await primeCodexLiveModels();
    assert.equal(calls, 2);
    assert.deepEqual(readCodexLiveModels()?.models, ['gpt-6-astra']);
    assert.equal(readCodexLiveModels()?.source, 'opencodex');
});

test('an empty answer is not stored as a catalog', async () => {
    scenario([async () => ({ models: [], entries: [], source: 'opencodex' as const })]);
    assert.equal(await primeCodexLiveModels(), null);
});

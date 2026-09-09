import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateAndCollectData } from '../../src/orchestrator/collect.ts';

test('a real collector exception carries private provenance without fabricating native finality', async context => {
    let network = 0;
    context.mock.method(globalThis, 'fetch', async () => { network++; throw new Error('Unexpected network'); });
    const result = await orchestrateAndCollectData('fixture task', {
        origin: 'slack', scope: 'collector-failure', chatSessionId: 'default', requestId: 'collector-failure-request',
        _skipInsert: true, _skipReplayDrain: true,
        _spawnAgent: () => ({ child: null, promise: Promise.reject(new Error('PRIVATE_PROVIDER_EXCEPTION')) }),
    }, 'en');
    assert.equal(result.data.collectionFailure, 'error');
    assert.equal(result.data.runtimeFinality, undefined);
    assert.equal(result.data.runtimeStatus, undefined);
    assert.match(result.text, /PRIVATE_PROVIDER_EXCEPTION/, 'collector selection is unchanged; Slack uses the private marker to choose safe copy');
    assert.equal(network, 0);
});

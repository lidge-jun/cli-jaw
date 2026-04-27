import test from 'node:test';
import assert from 'node:assert/strict';
import { createObservability } from '../../src/manager/observability.ts';

test('observability retains last N events FIFO', () => {
    const bus = createObservability({ retention: 3 });
    for (let i = 0; i < 5; i += 1) {
        bus.publish({ kind: 'scan-failed', reason: `r${i}`, at: `2026-04-28T00:00:0${i}Z` });
    }
    const events = bus.snapshot();
    assert.equal(events.length, 3);
    assert.equal(events[0].kind, 'scan-failed');
    if (events[0].kind === 'scan-failed') assert.equal(events[0].reason, 'r2');
});

test('observability drain returns events strictly after the since cursor', () => {
    const bus = createObservability({ retention: 10 });
    bus.publish({ kind: 'scan-failed', reason: 'old', at: '2026-04-28T00:00:00Z' });
    bus.publish({ kind: 'scan-failed', reason: 'new', at: '2026-04-28T00:00:05Z' });
    const drained = bus.drain('2026-04-28T00:00:00Z');
    assert.equal(drained.length, 1);
    if (drained[0].kind === 'scan-failed') assert.equal(drained[0].reason, 'new');
});

test('observability drain with invalid since returns empty array', () => {
    const bus = createObservability({ retention: 10 });
    bus.publish({ kind: 'scan-failed', reason: 'x', at: '2026-04-28T00:00:00Z' });
    assert.deepEqual(bus.drain('not-a-date'), []);
});

test('observability drain without cursor returns all retained events', () => {
    const bus = createObservability({ retention: 10 });
    bus.publish({ kind: 'lifecycle-result', port: 3457, action: 'start', status: 'started', message: 'ok', at: '2026-04-28T00:00:00Z' });
    bus.publish({ kind: 'health-changed', port: 3458, from: 'offline', to: 'online', reason: null, at: '2026-04-28T00:00:01Z' });
    assert.equal(bus.drain().length, 2);
    assert.equal(bus.drain(null).length, 2);
});

test('observability clear empties the buffer', () => {
    const bus = createObservability({ retention: 10 });
    bus.publish({ kind: 'scan-failed', reason: 'x', at: '2026-04-28T00:00:00Z' });
    bus.clear();
    assert.equal(bus.snapshot().length, 0);
});

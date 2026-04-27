import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHealthHistory } from '../../src/manager/health-history.ts';

test('health history retains the last N events per port', () => {
    const history = createHealthHistory({ retentionPerPort: 3, persistPath: null });
    for (let i = 0; i < 5; i += 1) {
        history.record({
            port: 3457,
            at: new Date(Date.UTC(2026, 3, 28, 0, i, 0)).toISOString(),
            status: i % 2 === 0 ? 'online' : 'offline',
            reason: null,
            versionSeen: 'v1.0.0',
        });
    }
    const events = history.list(3457);
    assert.equal(events.length, 3);
    assert.equal(events[0].at, new Date(Date.UTC(2026, 3, 28, 0, 2, 0)).toISOString());
    assert.equal(events[2].at, new Date(Date.UTC(2026, 3, 28, 0, 4, 0)).toISOString());
});

test('health history list respects optional limit', () => {
    const history = createHealthHistory({ retentionPerPort: 10, persistPath: null });
    for (let i = 0; i < 6; i += 1) {
        history.record({ port: 3458, at: `2026-04-28T00:00:0${i}Z`, status: 'online', reason: null, versionSeen: null });
    }
    assert.equal(history.list(3458, 2).length, 2);
    assert.equal(history.list(3458, 99).length, 6);
});

test('health history purge drops events older than the cutoff', () => {
    const history = createHealthHistory({ retentionPerPort: 50, persistPath: null });
    const now = Date.now();
    history.record({ port: 3457, at: new Date(now - 60_000).toISOString(), status: 'online', reason: null, versionSeen: null });
    history.record({ port: 3457, at: new Date(now - 5_000).toISOString(), status: 'offline', reason: 'fresh', versionSeen: null });
    history.purge(30_000);
    const remaining = history.list(3457);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].reason, 'fresh');
});

test('health history persists to disk when path provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jaw-history-'));
    const file = join(dir, 'history.json');
    const history = createHealthHistory({ retentionPerPort: 5, persistPath: file });
    history.record({ port: 3457, at: '2026-04-28T01:00:00Z', status: 'online', reason: null, versionSeen: 'v1' });
    assert.equal(existsSync(file), true);
    const reloaded = createHealthHistory({ retentionPerPort: 5, persistPath: file });
    assert.equal(reloaded.list(3457).length, 1);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    assert.ok(Array.isArray(raw['3457']));
});

test('health history listAll sorts cross-port events chronologically', () => {
    const history = createHealthHistory({ retentionPerPort: 5, persistPath: null });
    history.record({ port: 3458, at: '2026-04-28T00:00:02Z', status: 'online', reason: null, versionSeen: null });
    history.record({ port: 3457, at: '2026-04-28T00:00:01Z', status: 'online', reason: null, versionSeen: null });
    const all = history.listAll();
    assert.equal(all.length, 2);
    assert.equal(all[0].port, 3457);
    assert.equal(all[1].port, 3458);
});

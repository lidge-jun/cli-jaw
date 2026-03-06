// ACP heartbeat gating — pure function tests
// Tests shouldEmitHeartbeat() from spawn.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldEmitHeartbeat } from '../../src/agent/spawn.ts';

// ─── shouldEmitHeartbeat ─────────────────────────────

test('heartbeat suppressed within gate window', () => {
    const now = Date.now();
    assert.equal(
        shouldEmitHeartbeat(now - 5000, false, 20_000, now),
        false,
        'should not emit when only 5s elapsed (gate is 20s)',
    );
});

test('heartbeat emitted after gate window', () => {
    const now = Date.now();
    assert.equal(
        shouldEmitHeartbeat(now - 25_000, false, 20_000, now),
        true,
        'should emit when 25s elapsed (gate is 20s)',
    );
});

test('heartbeat suppressed when already sent', () => {
    const now = Date.now();
    assert.equal(
        shouldEmitHeartbeat(now - 25_000, true, 20_000, now),
        false,
        'should not emit twice — heartbeatSent=true gates it',
    );
});

test('heartbeat at exact gate boundary is suppressed', () => {
    const now = Date.now();
    assert.equal(
        shouldEmitHeartbeat(now - 20_000, false, 20_000, now),
        false,
        'should not emit at exactly 20s (needs to be > gateMs)',
    );
});

test('heartbeat with custom gate value', () => {
    const now = Date.now();
    assert.equal(
        shouldEmitHeartbeat(now - 10_000, false, 5_000, now),
        true,
        'should emit when 10s elapsed with custom gate of 5s',
    );
});

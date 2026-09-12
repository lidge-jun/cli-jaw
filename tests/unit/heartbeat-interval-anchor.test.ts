// The interval grid, and why a save must not move it.
//
// `setInterval` measured from the ARM, and `startHeartbeat` re-arms on boot
// (`server.ts:756`), on every `PUT /api/heartbeat`, on every `heartbeat.json`
// write the watcher sees, and on a mention-watch fresh start. A home saved more
// often than a job's period therefore never reached that job's first fire, and
// nothing logged it because each arm looked correct on its own.
//
// Two of these tests are regression guards for defects an independent audit found
// in the FIRST version of the anchored design: a period change that kept its old
// origin could fire almost immediately, and an uncapped backwards-clock rule could
// arm a timer for a month.
import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';

import type { HeartbeatJob } from '../../src/core/config.ts';
import {
    startHeartbeat,
    stopHeartbeat,
    nextIntervalDelay,
    getHeartbeatIntervalAnchor,
    getHeartbeatLiveDestinationHold,
    updateHeartbeatLiveDestinationHold,
    saveHeartbeatFile,
} from '../../src/memory/heartbeat.ts';

const MINUTE = 60_000;

function everyJob(id: string, minutes: number): HeartbeatJob {
    return { id, name: id, enabled: true, prompt: 'tick', schedule: { kind: 'every', minutes } };
}

/** Freeze the clock for one synchronous call. `startHeartbeat` reads `Date.now`
 *  when it anchors, and nothing else in these tests is time-dependent. */
function withNow<T>(at: number, fn: () => T): T {
    const real = Date.now;
    Date.now = () => at;
    try { return fn(); } finally { Date.now = real; }
}

test('HIA-001 the delay is the remainder to the next boundary', () => {
    const anchor = 1_000_000;
    assert.equal(nextIntervalDelay(anchor, 60 * MINUTE, anchor + 10 * MINUTE), 50 * MINUTE);
    assert.equal(nextIntervalDelay(anchor, 60 * MINUTE, anchor + 59 * MINUTE + 59_000), 1_000);
});

test('HIA-002 exactly on a boundary waits a full period, never zero', () => {
    const anchor = 1_000_000;
    assert.equal(nextIntervalDelay(anchor, 5 * MINUTE, anchor), 5 * MINUTE);
    assert.equal(nextIntervalDelay(anchor, 5 * MINUTE, anchor + 15 * MINUTE), 5 * MINUTE);
});

test('HIA-003 a backwards clock is clamped to one period, not the raw distance', () => {
    // An unref'd timer armed for a month is not a schedule, and setInterval could
    // never express one.
    const anchor = 10 * 24 * 60 * MINUTE;
    assert.equal(nextIntervalDelay(anchor, 5 * MINUTE, anchor - 30 * 24 * 60 * MINUTE), 5 * MINUTE);
    assert.equal(nextIntervalDelay(anchor, 5 * MINUTE, anchor - 60_000), 60_000);
});

test('HIA-004 the delay always lands inside (0, periodMs]', () => {
    const period = 7 * MINUTE;
    for (const offset of [-5_000_000, -1, 0, 1, 999, period - 1, period, period + 1, 12_345_678]) {
        const delay = nextIntervalDelay(1_000_000, period, 1_000_000 + offset);
        assert.ok(delay > 0 && delay <= period, `offset ${offset} produced ${delay}`);
    }
});

test('HIA-005 re-arming inside one period does not reset the grid', () => {
    saveHeartbeatFile({ jobs: [everyJob('j-long', 60)] });
    const t0 = 1_700_000_000_000;
    withNow(t0, () => { startHeartbeat(); });
    const first = getHeartbeatIntervalAnchor('j-long');
    assert.equal(first, t0);

    // Three saves inside one period. With setInterval each of these restarted the
    // full hour, so the job never fired at all.
    for (const step of [10, 20, 30]) withNow(t0 + step * MINUTE, () => { startHeartbeat(); });

    assert.equal(getHeartbeatIntervalAnchor('j-long'), first, 'a save must not move the anchor');
    assert.equal(nextIntervalDelay(first ?? 0, 60 * MINUTE, t0 + 30 * MINUTE), 30 * MINUTE);
    stopHeartbeat();
});

test('HIA-006 changing the period re-anchors instead of firing almost at once', () => {
    saveHeartbeatFile({ jobs: [everyJob('j-period', 60)] });
    const t0 = 1_700_000_000_000;
    withNow(t0, () => { startHeartbeat(); });
    assert.equal(getHeartbeatIntervalAnchor('j-period'), t0);

    // Keeping the old origin under the new period would leave 121 % 61 = 60
    // minutes elapsed on the new grid, i.e. a one-minute delay on a 61-minute job.
    const later = t0 + 121 * MINUTE;
    assert.equal(nextIntervalDelay(t0, 61 * MINUTE, later), 1 * MINUTE);

    saveHeartbeatFile({ jobs: [everyJob('j-period', 61)] });
    withNow(later, () => { startHeartbeat(); });

    assert.equal(getHeartbeatIntervalAnchor('j-period'), later, 'a period change must re-anchor');
    assert.equal(nextIntervalDelay(later, 61 * MINUTE, later), 61 * MINUTE);
    stopHeartbeat();
});

test('HIA-007 a job removed from the file leaves no anchor or live hold behind', () => {
    const kept = everyJob('j-kept', 5);
    const dropped = everyJob('j-dropped', 5);
    saveHeartbeatFile({ jobs: [kept, dropped] });
    withNow(1_700_000_000_000, () => { startHeartbeat(); });
    updateHeartbeatLiveDestinationHold(dropped, 'stale_thread');
    assert.equal(getHeartbeatLiveDestinationHold(dropped), 'stale_thread');
    assert.ok(getHeartbeatIntervalAnchor('j-dropped') !== undefined);

    saveHeartbeatFile({ jobs: [kept] });
    withNow(1_700_000_100_000, () => { startHeartbeat(); });

    assert.equal(getHeartbeatIntervalAnchor('j-dropped'), undefined, 'anchor must be pruned');
    assert.equal(getHeartbeatLiveDestinationHold(dropped), null, 'live hold must be pruned');
    assert.ok(getHeartbeatIntervalAnchor('j-kept') !== undefined, 'the surviving job keeps its grid');
    stopHeartbeat();
});

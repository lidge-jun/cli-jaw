import test from 'node:test';
import assert from 'node:assert/strict';
import { SlackActionRateLimiter } from '../../src/slack/action-rate.ts';

function fixture() {
    const clock = { ms: 10000 }; const waits: number[] = [];
    const limiter = new SlackActionRateLimiter(() => clock.ms, async ms => { waits.push(ms); });
    return { clock, waits, limiter };
}
test('same workspace/method reserves tier-two 3s and tier-three 1.2s slots', async () => {
    const { limiter, waits } = fixture();
    await limiter.admit('T1', 'reactions.get'); await limiter.admit('T1', 'reactions.get'); await limiter.admit('T1', 'reactions.get');
    await limiter.admit('T1', 'reactions.add'); await limiter.admit('T1', 'reactions.add');
    assert.deepEqual(waits, [3000, 6000, 1200]);
});
test('workspaces and methods have independent queues', async () => {
    const { limiter, waits } = fixture();
    await limiter.admit('T1', 'reactions.get'); await limiter.admit('T2', 'reactions.get'); await limiter.admit('T1', 'pins.list');
    assert.deepEqual(waits, []);
    await limiter.admit('T2', 'reactions.get'); assert.deepEqual(waits, [3000]);
});
test('concurrent admission reserves distinct slots before waits settle', async () => {
    const waits: number[] = []; const releases: Array<() => void> = [];
    const limiter = new SlackActionRateLimiter(() => 0, ms => new Promise(resolve => { waits.push(ms); releases.push(resolve); }));
    await limiter.admit('T1', 'reactions.get');
    const second = limiter.admit('T1', 'reactions.get'); const third = limiter.admit('T1', 'reactions.get');
    assert.deepEqual(waits, [3000, 6000]); releases.forEach(resolve => resolve()); await Promise.all([second, third]);
});
test('maximum wait rejects over 10s without consuming another slot', async () => {
    const { limiter, waits, clock } = fixture();
    for (let i = 0; i < 9; i++) await limiter.admit('T1', 'reactions.add');
    await assert.rejects(limiter.admit('T1', 'reactions.add'), error => error instanceof Error && error.message === 'slack_action_rate_limited' && (error as Error & { retryAfterMs: number }).retryAfterMs === 10800);
    assert.equal(waits.at(-1), 9600);
    clock.ms += 800; await limiter.admit('T1', 'reactions.add'); assert.equal(waits.at(-1), 10000);
});
test('pre-aborted admission does not reserve capacity', async () => {
    const { limiter, waits } = fixture(); const controller = new AbortController(); controller.abort();
    await assert.rejects(limiter.admit('T1', 'reactions.get', controller.signal), /slack_action_cancelled/);
    await limiter.admit('T1', 'reactions.get'); assert.deepEqual(waits, []);
});
test('abort during injected wait is checked even if the pause resolves', async () => {
    const controller = new AbortController(); let observedSignal: AbortSignal | undefined;
    const limiter = new SlackActionRateLimiter(() => 0, async (_ms, signal) => { observedSignal = signal; controller.abort(); });
    await limiter.admit('T1', 'reactions.get');
    await assert.rejects(limiter.admit('T1', 'reactions.get', controller.signal), /slack_action_cancelled/);
    assert.equal(observedSignal, controller.signal);
});
test('default pause aborts promptly rather than waiting for the reserved timer', async () => {
    const limiter = new SlackActionRateLimiter(() => 0); const controller = new AbortController();
    await limiter.admit('T1', 'reactions.get');
    const waiting = limiter.admit('T1', 'reactions.get', controller.signal);
    controller.abort(); await assert.rejects(waiting, /slack_action_cancelled/);
});
test('pause rejection propagates without a retry', async () => {
    let pauses = 0;
    const limiter = new SlackActionRateLimiter(() => 0, async () => { pauses++; throw new Error('fixture_pause_failed'); });
    await limiter.admit('T1', 'reactions.get');
    await assert.rejects(limiter.admit('T1', 'reactions.get'), /fixture_pause_failed/); assert.equal(pauses, 1);
});
test('capacity rejects a new key until expired queues can be reclaimed', async () => {
    const { limiter, waits, clock } = fixture();
    for (let i = 0; i < 1024; i++) await limiter.admit(`T${i}`, 'reactions.get');
    await assert.rejects(limiter.admit('NEW', 'reactions.get'), /slack_action_rate_capacity/);
    await limiter.admit('T0', 'reactions.get'); assert.deepEqual(waits, [3000]);
    clock.ms += 3000; await limiter.admit('NEW', 'reactions.get');
    assert.deepEqual(waits, [3000]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import { attachWatchdog, type WatchdogHandle } from '../../src/agent/watchdog.ts';

function fakeChild(): ChildProcess {
    return {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
    } as unknown as ChildProcess;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForStall(
    handleRef: { handle?: WatchdogHandle },
    config: Parameters<typeof attachWatchdog>[3],
): Promise<string> {
    return new Promise((resolve) => {
        const child = fakeChild();
        handleRef.handle = attachWatchdog(child, 'test', resolve, config);
    });
}

test('active progress extends absolute deadline past original absoluteMs', async () => {
    const child = fakeChild();
    let handle: WatchdogHandle | undefined;
    let stalled = false;
    const progress = setInterval(() => {
        child.stdout?.emit('data', Buffer.from('ordinary progress output\n'));
    }, 5);
    try {
        const stallPromise = new Promise<string>((resolve) => {
            handle = attachWatchdog(child, 'test', resolve, {
                firstProgressMs: 1_000,
                idleMs: 1_000,
                absoluteMs: 30,
                absoluteHardCapMs: 200,
                checkIntervalMs: 5,
            });
        }).then(reason => { stalled = true; return reason; });

        await sleep(80);
        assert.equal(stalled, false, 'active progress should extend deadline past original absoluteMs');

        const reason = await stallPromise;
        assert.match(reason, /absolute timeout/);
    } finally {
        clearInterval(progress);
        handle?.stop();
    }
});

test('absolute timeout fires without any progress', async () => {
    const handleRef: { handle?: WatchdogHandle } = {};
    const reason = await waitForStall(handleRef, {
        firstProgressMs: 1_000,
        idleMs: 1_000,
        absoluteMs: 30,
        checkIntervalMs: 5,
    });
    assert.match(reason, /absolute timeout/);
});

test('extendDeadline delays absolute timeout', async () => {
    const handleRef: { handle?: WatchdogHandle } = {};
    let stalled = false;
    const stallPromise = waitForStall(handleRef, {
        firstProgressMs: 1_000,
        idleMs: 1_000,
        absoluteMs: 30,
        absoluteHardCapMs: 300,
        checkIntervalMs: 5,
    }).then((reason) => {
        stalled = true;
        return reason;
    });

    await sleep(10);
    handleRef.handle?.extendDeadline(120, 'test extension');
    await sleep(65);
    assert.equal(stalled, false, 'deadline should be extended beyond the original absolute timeout');

    const reason = await stallPromise;
    assert.match(reason, /absolute timeout/);
});

test('extendDeadline is monotonic and does not shorten deadline', async () => {
    const handleRef: { handle?: WatchdogHandle } = {};
    let stalled = false;
    const stallPromise = waitForStall(handleRef, {
        firstProgressMs: 1_000,
        idleMs: 1_000,
        absoluteMs: 40,
        absoluteHardCapMs: 300,
        checkIntervalMs: 5,
    }).then((reason) => {
        stalled = true;
        return reason;
    });

    await sleep(10);
    handleRef.handle?.extendDeadline(160, 'long extension');
    await sleep(10);
    handleRef.handle?.extendDeadline(20, 'shorter ignored extension');
    await sleep(90);
    assert.equal(stalled, false, 'shorter extension should not shrink the deadline');

    const reason = await stallPromise;
    assert.match(reason, /absolute timeout/);
});

test('extendDeadline respects absolute hard cap', async () => {
    const startedAt = Date.now();
    const handleRef: { handle?: WatchdogHandle } = {};
    const stallPromise = waitForStall(handleRef, {
        firstProgressMs: 1_000,
        idleMs: 1_000,
        absoluteMs: 30,
        absoluteHardCapMs: 80,
        checkIntervalMs: 5,
    });

    await sleep(10);
    handleRef.handle?.extendDeadline(1_000, 'capped extension');
    const reason = await stallPromise;
    const elapsed = Date.now() - startedAt;

    assert.match(reason, /absolute timeout/);
    assert.ok(elapsed < 250, `expected hard cap to bound timeout, elapsed=${elapsed}`);
});

test('stop prevents future stall callbacks', async () => {
    const child = fakeChild();
    let called = false;
    const handle = attachWatchdog(child, 'test', () => {
        called = true;
    }, {
        firstProgressMs: 20,
        idleMs: 20,
        absoluteMs: 20,
        checkIntervalMs: 5,
    });

    handle.stop();
    await sleep(60);
    assert.equal(called, false);
});

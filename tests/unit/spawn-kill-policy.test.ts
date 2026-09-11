import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { ChildProcess } from 'node:child_process';

const { OwnedProcess } = await import('../../src/agent/spawn/process-kill.ts');
const { armExitSettle, captureExitSettler, settleCapturedExit, waitForExitSettled } =
    await import('../../src/agent/spawn/exit-settle.ts');
const { killAgentById, activeProcesses } = await import('../../src/agent/spawn.ts');

/** A child that catches SIGTERM and keeps running — the case `ChildProcess.killed` hides. */
async function spawnTermTrappingChild(): Promise<ChildProcess> {
    const child = spawn(process.execPath, ['-e',
        "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('READY');",
    ]);
    // Waiting on the 'spawn' event is not enough: it fires before node has evaluated
    // -e, so a SIGTERM sent immediately after would arrive while the default handler
    // is still installed and the child would die on the first signal — proving nothing.
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('trap fixture never reported ready')), 10_000);
        child.stdout!.on('data', (chunk: Buffer) => {
            if (chunk.toString().includes('READY')) { clearTimeout(timer); resolve(); }
        });
        child.once('error', err => { clearTimeout(timer); reject(err); });
    });
    return child;
}

// ─── KP-001 ───
//
// Worker stop (`orchestrator/distribute.ts`, `orchestrator/pipeline.ts`) reaches
// `killAgentById`, which used to escalate on a bare timer with no liveness re-check
// and a different grace from main stop. A CLI that traps SIGTERM therefore survived
// worker stop while main stop escalated correctly (#683).

test('KP-001: killAgentById escalates a SIGTERM-trapping worker to SIGKILL', { timeout: 15_000 }, async () => {
        const child = await spawnTermTrappingChild();
        const agentId = 'kp-001-trap';
    activeProcesses.set(agentId, child);
    try {
        assert.equal(killAgentById(agentId), true, 'the worker kill port must accept a live child');
        assert.equal(child.exitCode, null, 'SIGTERM alone must not have reaped a trapping child');
        await once(child, 'exit');
        assert.equal(child.signalCode, 'SIGKILL', 'the owner must escalate past a trapped SIGTERM');
    } finally {
        activeProcesses.delete(agentId);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
});

// ─── KP-002 ───
//
// The five rewritten kill sites deliberately pass no policy, because `ownProcess` is
// memoized and a late policy is honoured for a main run but silently dropped for a
// worker `registerActiveProcess` already owns. That only works if the DEFAULT policy
// is the one each site wants, so pin it: the print stall watchdog keeps its 5s and
// everything else takes the 2s DEFAULT_KILL_ESCALATION_MS.

test('KP-002: the default policy preserves each site grace without an override', () => {
    for (const [reason, expected] of [['stall', 5_000], ['cancel', 2_000], ['completion', 2_000], ['steer', 2_000]] as const) {
        const signals: Array<{ pid: number; signal: string }> = [];
        const timers: Array<{ delay: number; fn: () => void }> = [];
        const child = { pid: 4242, exitCode: null, signalCode: null, once: () => child } as unknown as ChildProcess;
        const owned = new OwnedProcess(child, {
            terminateTree: (pid, signal = 'SIGTERM') => { signals.push({ pid, signal }); },
            setTimer: ((fn: () => void, delay: number) => {
                timers.push({ delay, fn });
                return { unref() { return this; } } as unknown as NodeJS.Timeout;
            }) as unknown as typeof setTimeout,
        });
        owned.terminate(reason);
        assert.deepEqual(signals, [{ pid: 4242, signal: 'SIGTERM' }], `${reason} starts with SIGTERM`);
        assert.equal(timers.length, 1, `${reason} schedules exactly one escalation`);
        assert.equal(timers[0]!.delay, expected, `${reason} keeps its ${expected}ms grace`);
        timers[0]!.fn();
        assert.deepEqual(signals[1], { pid: 4242, signal: 'SIGKILL' }, `${reason} escalates`);
    }
});

// ─── KP-003 ───
//
// The barrier moved to its own module so it could be imported without spawn behind
// it (#697). The part that had to survive the move is identity: a runtime settles
// from a `finally` block, and by then a second steer may have armed a NEW barrier
// for the same scope. Resolving that one would release a waiter for output nobody
// has written yet.

test('KP-003: a captured arm never settles a successor arm for the same scope', async () => {
    const scope = 'kp-003';
    armExitSettle(scope);
    const first = captureExitSettler(scope);
    assert.ok(first, 'the first steer arms a barrier');

    assert.equal(settleCapturedExit(scope, first), true, 'its own arm settles');
    await waitForExitSettled(scope, 50);

    armExitSettle(scope);
    const second = captureExitSettler(scope);
    assert.notEqual(second, first, 'a later steer arms a distinct barrier');
    assert.equal(settleCapturedExit(scope, first), false, 'the stale capture must not settle it');

    let released = false;
    const waiter = waitForExitSettled(scope, 5_000).then(() => { released = true; });
    await new Promise(r => setTimeout(r, 60));
    assert.equal(released, false, 'the successor arm still holds its waiter');

    assert.equal(settleCapturedExit(scope, second), true, 'the matching capture releases it');
    await waiter;
    assert.equal(released, true);
});

test('KP-004: settleCapturedExit is a no-op for an unarmed scope', () => {
    // Never a blind settleExit: an unarmed scope has nobody waiting, and treating
    // "I captured nothing" as "settle whatever is there" would resolve another
    // turn's barrier.
    assert.equal(settleCapturedExit('kp-004-never-armed', undefined), false);
});

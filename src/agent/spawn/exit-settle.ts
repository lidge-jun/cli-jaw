// ─── Steer exit-settle barrier ───
//
// `killActiveAgent` removes the scope's `activeMainProcesses` entry synchronously, so
// `waitForProcessEnd()` resolves immediately on a steer kill — long before the exit
// handler has written the interrupted partial output to the messages table. A follow-up
// spawn could then read history without the salvage row. The barrier is armed at kill
// time (never at exit-handler entry — that is already too late) and settled by the exit
// handler's completion, success or failure (#523).
//
// Extracted from spawn.ts as a leaf so it can be imported without the server graph
// behind it. That is what makes the drain regression in #697 possible: a child process
// can import this module alone and observe whether the timeout keeps the loop alive.

export type ExitSettler = { promise: Promise<void>; resolve: () => void };

const exitSettlers = new Map<string, ExitSettler>();

/** Arm the barrier. Idempotent: a repeated steer keeps the first arm. */
export function armExitSettle(scopeKey: string): void {
    if (exitSettlers.has(scopeKey)) return;
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    exitSettlers.set(scopeKey, { promise, resolve });
}

/**
 * Take a reference to the arm that is live right now.
 *
 * Runtimes that settle from a `finally` block must settle THEIR arm, not whatever is
 * in the map when the block finally runs: a second steer can arm a new barrier for the
 * same scope while the first turn is still unwinding, and resolving that one would
 * release a waiter for output nobody has written yet.
 */
export function captureExitSettler(scopeKey: string): ExitSettler | undefined {
    return exitSettlers.get(scopeKey);
}

/**
 * Settle a captured arm, but only if the map still holds that exact entry.
 *
 * Returns whether it settled. A missing capture is a no-op, never a blind
 * `settleExit` — an unarmed scope has no one waiting and a superseded arm belongs to
 * a turn that is still running.
 */
export function settleCapturedExit(scopeKey: string, captured: ExitSettler | undefined): boolean {
    if (!captured || exitSettlers.get(scopeKey) !== captured) return false;
    exitSettlers.delete(scopeKey);
    captured.resolve();
    return true;
}

/** Settle the barrier; a no-op when no steer kill armed it. */
export function settleExit(scopeKey: string): void {
    const entry = exitSettlers.get(scopeKey);
    if (!entry) return;
    exitSettlers.delete(scopeKey);
    entry.resolve();
}

/**
 * Await the armed exit handler's completion, bounded. A timeout releases the waiter
 * and drops the arm — a wedged exit handler must not hang the steer.
 */
export function waitForExitSettled(scopeKey: string, timeoutMs = 5000): Promise<void> {
    const entry = exitSettlers.get(scopeKey);
    if (!entry) return Promise.resolve();
    // The timer is NOT unref'd and is always cleared: an unref'd timer can vanish
    // with a drained event loop (test runner), leaving the waiter pending forever.
    // Regression: tests/unit/spawn-exit-settle-drain.test.ts.
    let timer: NodeJS.Timeout;
    const timeout = new Promise<void>(r => { timer = setTimeout(r, timeoutMs); });
    return Promise.race([entry.promise, timeout]).then(() => {
        clearTimeout(timer);
        if (exitSettlers.get(scopeKey) === entry) exitSettlers.delete(scopeKey);
    });
}

/**
 * Last native start failure per CLI, for `/api/cli-status`.
 *
 * A native runtime that dies before its first turn produced only
 * `[native-runtime-run] failed stages: run` in the server log, and a generic
 * no-response message on the channel, so a bad model id, an ambiguous config
 * selector, a failed handshake and an auth problem were indistinguishable
 * (#658). The log now carries the code; this store carries the same code to a
 * surface the settings UI can read, so an operator without repository access can
 * see why a selected transport is not working.
 *
 * Two boundaries make that safe to expose.
 *
 * Only codes travel. The value is whatever `safeFailureCode` admits — a message
 * that is entirely one lower-case snake_case identifier — so provider text and
 * credentials cannot take this shape. An empty walk records nothing rather than
 * falling back to a raw message.
 *
 * Only starts are recorded. The caller records when the run never acquired a
 * lease, which is the failure this answers. Teardown faults after a claimed
 * answer, such as `native_run_cleanup_timeout`, are a different class and must
 * not appear here or in the cached probe row, whose readiness semantics (#277)
 * are separate evidence.
 */
import { safeFailureCode } from '../native-runtime-run.js';

export interface NativeStartFailure {
    /** One provider-independent identifier raised by the runtime layer. */
    readonly code: string;
    /** Epoch milliseconds, so a stale record is recognizable as stale. */
    readonly at: number;
}

// A cause chain is bounded rather than trusted: an AggregateError can nest, and
// this walk runs on a failure path that is already going wrong.
const MAX_NODES = 32;

/** First safe code in the failure, walking causes and aggregated errors. */
export function startFailureCode(error: unknown): string {
    const queue: unknown[] = [error];
    for (let visited = 0; queue.length && visited < MAX_NODES; visited++) {
        const node = queue.shift();
        const code = safeFailureCode(node);
        if (code) return code;
        if (!(node instanceof Error)) continue;
        if (node instanceof AggregateError && Array.isArray(node.errors)) queue.push(...node.errors);
        if (node.cause !== undefined) queue.push(node.cause);
    }
    return '';
}

const failures = new Map<string, NativeStartFailure>();

/** Record only from a run that never acquired a lease; a silent walk is not recorded. */
export function recordNativeStartFailure(cli: string, error: unknown, now = Date.now()): void {
    const code = startFailureCode(error);
    if (!cli || !code) return;
    failures.set(cli, { code, at: now });
}

/** A later start that reached its lease retires the previous evidence. */
export function clearNativeStartFailure(cli: string): void {
    failures.delete(cli);
}

export function nativeStartFailure(cli: string): NativeStartFailure | undefined {
    return failures.get(cli);
}

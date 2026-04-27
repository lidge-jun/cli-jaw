/**
 * 10.7.4 — Lifecycle reactive polling helper.
 *
 * Polls a single instance status until the expected post-lifecycle state is
 * reached or the cap (default 16 attempts × 500ms = 8s) is hit. Pure utility:
 * caller injects fetchOnce so this works with both real fetch and tests.
 */

import type { DashboardInstance, DashboardLifecycleExpectedState } from './types';

export type PollUntilSettledOptions = {
    port: number;
    expected: DashboardLifecycleExpectedState;
    previousUptime?: number | null;
    maxAttempts?: number;
    intervalMs?: number;
    fetchOnce: (port: number, signal: AbortSignal) => Promise<DashboardInstance | null>;
    signal?: AbortSignal;
    onAttempt?: (instance: DashboardInstance | null, attempt: number) => void;
};

export type PollUntilSettledResult = {
    settled: boolean;
    attempts: number;
    instance: DashboardInstance | null;
};

export async function pollUntilSettled(options: PollUntilSettledOptions): Promise<PollUntilSettledResult> {
    const maxAttempts = Math.max(1, options.maxAttempts ?? 16);
    const intervalMs = Math.max(50, options.intervalMs ?? 500);
    let lastInstance: DashboardInstance | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (options.signal?.aborted) {
            return { settled: false, attempts: attempt - 1, instance: lastInstance };
        }
        const internal = new AbortController();
        const onParentAbort = () => internal.abort();
        options.signal?.addEventListener('abort', onParentAbort, { once: true });
        try {
            lastInstance = await options.fetchOnce(options.port, internal.signal);
        } catch {
            lastInstance = null;
        } finally {
            options.signal?.removeEventListener('abort', onParentAbort);
        }
        options.onAttempt?.(lastInstance, attempt);
        if (matchesExpected(lastInstance, options)) {
            return { settled: true, attempts: attempt, instance: lastInstance };
        }
        if (attempt === maxAttempts) break;
        await delay(intervalMs, options.signal);
    }
    return { settled: false, attempts: maxAttempts, instance: lastInstance };
}

function matchesExpected(instance: DashboardInstance | null, options: PollUntilSettledOptions): boolean {
    if (options.expected === 'online') {
        return instance?.status === 'online';
    }
    if (options.expected === 'offline') {
        if (!instance) return true;
        return instance.status !== 'online';
    }
    if (options.expected === 'restart-detected') {
        if (!instance || instance.status !== 'online') return false;
        if (typeof instance.uptime !== 'number') return false;
        if (typeof options.previousUptime !== 'number') return true;
        return instance.uptime < options.previousUptime;
    }
    return false;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        function cleanup(): void {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        }
        function onAbort(): void {
            cleanup();
            resolve();
        }
        if (signal?.aborted) {
            cleanup();
            resolve();
            return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

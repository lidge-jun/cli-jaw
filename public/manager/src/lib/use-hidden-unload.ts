import { useEffect, useRef } from 'react';

export type HiddenUnloadOptions = {
    enabled: boolean;
    onUnload: () => void;
    idleMs?: number;
};

export const DEFAULT_HIDDEN_UNLOAD_IDLE_MS = 5 * 60 * 1000;

/**
 * Installs a `visibilitychange` watcher that calls `onUnload` once when the document has been
 * hidden continuously for at least `idleMs`. Returns a cleanup function that removes the
 * listener and clears the pending timer.
 *
 * Best-effort: Chromium throttles `setTimeout` in background tabs (1s → 1min cadence) and may
 * freeze pages entirely. To compensate, we additionally check elapsed hidden time on the
 * `visibilitychange → visible` transition and fire `onUnload` immediately if the threshold was
 * already crossed while the timer was throttled or frozen.
 */
export function installHiddenUnloadWatcher(options: {
    onUnload: () => void;
    idleMs: number;
    doc: Pick<Document, 'addEventListener' | 'removeEventListener'> & { hidden: boolean };
    setTimeout: (cb: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
    now: () => number;
}): () => void {
    const { onUnload, idleMs, doc, setTimeout: setT, clearTimeout: clearT, now } = options;

    let timer: unknown = null;
    let hiddenSince: number | null = null;
    let fired = false;

    const fireOnce = () => {
        if (fired) return;
        fired = true;
        onUnload();
    };

    const startTimer = () => {
        hiddenSince = now();
        timer = setT(() => {
            timer = null;
            fireOnce();
        }, idleMs);
    };

    const clearPendingTimer = () => {
        if (timer !== null) {
            clearT(timer);
            timer = null;
        }
    };

    const handler = () => {
        if (fired) return;
        if (doc.hidden) {
            if (hiddenSince === null) startTimer();
            return;
        }
        const elapsed = hiddenSince !== null ? now() - hiddenSince : 0;
        clearPendingTimer();
        hiddenSince = null;
        if (elapsed >= idleMs) {
            fireOnce();
        }
    };

    if (doc.hidden) startTimer();
    doc.addEventListener('visibilitychange', handler as EventListener);
    // Page Lifecycle: a frozen tab can resume directly without a visibilitychange edge.
    // Run the same elapsed-time check on `resume` so freeze + late return still fires onUnload.
    doc.addEventListener('resume', handler as EventListener);

    return () => {
        doc.removeEventListener('visibilitychange', handler as EventListener);
        doc.removeEventListener('resume', handler as EventListener);
        clearPendingTimer();
    };
}

/**
 * Calls `onUnload` once when the document has been hidden continuously for at least `idleMs`.
 * Safe to call with `enabled === false`; the effect short-circuits and registers no listeners.
 */
export function useHiddenUnload(options: HiddenUnloadOptions): void {
    const { enabled, onUnload, idleMs = DEFAULT_HIDDEN_UNLOAD_IDLE_MS } = options;
    const onUnloadRef = useRef(onUnload);
    onUnloadRef.current = onUnload;

    useEffect(() => {
        if (!enabled) return undefined;
        if (typeof document === 'undefined') return undefined;
        return installHiddenUnloadWatcher({
            onUnload: () => onUnloadRef.current(),
            idleMs,
            doc: document,
            setTimeout: (cb, ms) => setTimeout(cb, ms),
            clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
            now: () => Date.now(),
        });
    }, [enabled, idleMs]);
}


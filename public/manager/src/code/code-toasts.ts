/**
 * A transient notice that appears over the transcript and leaves on its own.
 *
 * The composer footer used to carry these inline, which pushed the input down
 * and left a policy line sitting there long after it had been read. What
 * belongs here is news -- a setting saved, a policy changed, an action failed.
 * What does not belong here is anything the reader still has to act on: an
 * unconfirmed send or an archived session has to stay on screen until it is
 * resolved, and a notice that dismisses itself would strand them.
 */
export type CodeToastVariant = 'info' | 'warning' | 'error';

export type CodeToast = {
    /** Stable per source, so a repeated notice replaces rather than stacks. */
    id: string;
    message: string;
    variant: CodeToastVariant;
    /** Non-finite or <= 0 stays until dismissed. */
    durationMs: number;
    /** Distinguishes two pushes of the same id, so the timer restarts. */
    revision: number;
};

export const CODE_TOAST_DEFAULT_MS = 4000;
/** Three is enough to see a burst; more would cover the transcript. */
export const CODE_TOAST_MAX = 3;

export function codeToastAutoDismisses(toast: CodeToast): boolean {
    return Number.isFinite(toast.durationMs) && toast.durationMs > 0;
}

/**
 * Newest last, one entry per id. Re-pushing an id refreshes its content and
 * restarts its timer through a bumped revision, and moves it to the end so a
 * notice the reader just triggered is never the one dropped by the cap.
 */
export function pushCodeToast(
    list: readonly CodeToast[],
    next: Omit<CodeToast, 'revision'>,
): CodeToast[] {
    const previous = list.find(toast => toast.id === next.id);
    const kept = list.filter(toast => toast.id !== next.id);
    kept.push({ ...next, revision: (previous?.revision ?? 0) + 1 });
    return kept.slice(Math.max(0, kept.length - CODE_TOAST_MAX));
}

export function dismissCodeToast(list: readonly CodeToast[], id: string): CodeToast[] {
    const next = list.filter(toast => toast.id !== id);
    return next.length === list.length ? list as CodeToast[] : next;
}

/** An error is announced assertively; everything else waits its turn. */
export function codeToastIsAssertive(toast: CodeToast): boolean {
    return toast.variant === 'error';
}

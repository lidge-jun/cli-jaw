import type { CodeContextUsage } from '../../../../src/code-mode/wire';

/**
 * How much of the model's context the conversation is using.
 *
 * The runtime may report a token count without a window, or nothing at all, so
 * there are three answers and not one. A missing window is not an unlimited
 * one and a missing count is not zero, which is why neither collapses into a
 * number the reader would take as measured.
 */
export type ContextUsageView =
    | { state: 'hidden' }
    | { state: 'counted'; usedTokens: number }
    | { state: 'measured'; usedTokens: number; maxTokens: number; percent: number; over: boolean };

export function contextUsageView(usage: CodeContextUsage | undefined): ContextUsageView {
    if (!usage || !Number.isFinite(usage.totalTokens) || usage.totalTokens < 0) return { state: 'hidden' };
    const max = usage.modelContextWindow;
    if (max === null || !Number.isFinite(max) || max <= 0) return { state: 'counted', usedTokens: usage.totalTokens };
    // A count past the window is possible -- a model change moves the window
    // under a conversation that is already large. The ring cannot draw past
    // full, so the percentage is capped for the ring's sake, but the fact that
    // it was capped is carried rather than hidden: a label reading "100% used,
    // 533k of 258k" is self-contradictory, and quietly capping is how a wrong
    // number would look exactly like a full context.
    const raw = Math.round((usage.totalTokens / max) * 100);
    return { state: 'measured', usedTokens: usage.totalTokens, maxTokens: max,
        percent: Math.min(100, raw), over: raw > 100 };
}

/** Rounded to keep the control narrow; exact counts belong in the detail. */
export function formatTokens(value: number): string {
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value < 1000) return String(Math.round(value));
    if (value < 1_000_000) {
        const thousands = value / 1000;
        return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`;
    }
    const millions = value / 1_000_000;
    return `${millions < 10 ? millions.toFixed(1) : Math.round(millions)}M`;
}

/** An unreported part of the breakdown reads as absent, never as zero. */
export function formatOptionalTokens(value: number | null): string {
    return value === null ? '—' : formatTokens(value);
}

/**
 * Thresholds are about when to start paying attention, so they are named rather
 * than left as bare numbers at the call site.
 */
export function contextUsageLevel(percent: number): 'normal' | 'high' | 'critical' {
    if (percent >= 90) return 'critical';
    if (percent >= 75) return 'high';
    return 'normal';
}

export function contextUsageLabel(view: ContextUsageView): string {
    if (view.state === 'hidden') return '';
    if (view.state === 'counted') return `Context: ${formatTokens(view.usedTokens)} tokens used, window unknown`;
    if (view.over) return `Context: over the window, ${formatTokens(view.usedTokens)} of ${formatTokens(view.maxTokens)} tokens`;
    return `Context: ${view.percent}% used, ${formatTokens(view.usedTokens)} of ${formatTokens(view.maxTokens)} tokens`;
}

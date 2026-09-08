import { useId, useState } from 'react';
import type { CodeContextUsage } from '../../../../src/code-mode/wire';
import { contextUsageLabel, contextUsageLevel, contextUsageView, formatExactTokens, formatOptionalTokens, formatTokens } from './context-usage';

/**
 * How full the context window is, as a ring beside the composer controls.
 *
 * It renders nothing when the runtime has not reported usage, rather than
 * showing a zero that would read as measured. When a count arrives without a
 * window there is no ring, because a proportion of an unknown total is not a
 * proportion.
 */
export function ContextUsageMeter({ usage }: { usage: CodeContextUsage | undefined }) {
    const view = contextUsageView(usage);
    // Hover and focus are separate reasons to show the detail, tracked
    // separately. One boolean made them fight: clicking closed a panel the
    // pointer had opened, and blurring closed one the pointer was still over.
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const open = hovered || focused;
    const detailId = useId();
    if (view.state === 'hidden') return null;
    const label = contextUsageLabel(view);
    const level = view.state === 'measured' ? (view.over ? 'critical' : contextUsageLevel(view.percent)) : 'normal';
    const circumference = 2 * Math.PI * 7;
    const filled = view.state === 'measured' ? (view.percent / 100) * circumference : 0;
    return <div className="code-context-usage"
        onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
        {/* Described by, not expanded: the panel is a role="note" description
            and its numbers are already in this button's accessible name, so
            announcing an expandable widget would offer a control that reveals
            nothing new. */}
        <button type="button" className={`code-context-trigger is-${level}`}
            aria-label={label} aria-describedby={open ? detailId : undefined}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
            {view.state === 'measured'
                ? <svg className="code-context-ring" viewBox="0 0 18 18" aria-hidden="true">
                    <circle className="code-context-ring-track" cx="9" cy="9" r="7" />
                    <circle className="code-context-ring-fill" cx="9" cy="9" r="7"
                        strokeDasharray={`${filled} ${circumference}`} />
                </svg>
                : null}
            <span className="code-context-value">
                {view.state !== 'measured' ? formatTokens(view.usedTokens) : view.over ? 'over' : `${view.percent}%`}
            </span>
        </button>
        {open && <div id={detailId} className="code-context-detail" role="note">
            <p className="code-context-detail-total">
                {view.state === 'measured'
                    ? `${formatTokens(view.usedTokens)} of ${formatTokens(view.maxTokens)} tokens`
                    : `${formatTokens(view.usedTokens)} tokens used`}
            </p>
            {view.state === 'measured' && view.over
                && <p className="code-context-detail-note">Past the window the runtime last reported.</p>}
            {view.state === 'counted' && <p className="code-context-detail-note">This runtime did not report a context window.</p>}
            <dl className="code-context-breakdown">
                {/* Exact here, because the rounded form on the trigger cannot be
                    reconstructed into it and this is the only place the real
                    number appears. */}
                <div><dt>Used</dt><dd>{formatExactTokens(usage?.totalTokens ?? null)}</dd></div>
                <div><dt>Input</dt><dd>{formatOptionalTokens(usage?.inputTokens ?? null)}</dd></div>
                <div><dt>Cached</dt><dd>{formatOptionalTokens(usage?.cachedInputTokens ?? null)}</dd></div>
                <div><dt>Output</dt><dd>{formatOptionalTokens(usage?.outputTokens ?? null)}</dd></div>
                <div><dt>Reasoning</dt><dd>{formatOptionalTokens(usage?.reasoningOutputTokens ?? null)}</dd></div>
            </dl>
            {/* Spend, not occupancy: it counts every turn's tokens including the
                prompt resent each time, so it passes the window in ordinary use. */}
            {usage?.processedTokens != null && <p className="code-context-detail-note">
                Processed across the conversation: {formatTokens(usage.processedTokens)}</p>}
        </div>}
    </div>;
}

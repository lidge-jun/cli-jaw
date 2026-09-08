import { lazy, Suspense, useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CodeItem, CodeItemKind, CodeProviderId } from '../../../../src/code-mode/wire';
import { useCodeTranscriptVirtualRows } from './useCodeTranscriptVirtualRows';
import { useCodeTranscriptScroll } from './use-code-transcript-scroll';
import { useThrottledMarkdown } from './use-throttled-markdown';
import { CODE_RUNTIME_LABELS, codeItemStatus } from './code-types';
import { noteworthyStatus, toolSummary } from './tool-summary';
import { PENDING_USER_ITEM_ID } from './pending-user-item';

const MarkdownRenderer = lazy(() => import('../notes/rendering/MarkdownRenderer').then(m => ({ default: m.MarkdownRenderer })));

/**
 * Turn boundaries are bookkeeping, not conversation. A one-line answer framed by
 * "Turn started" and "Completed" reads as a status board, and neither line tells
 * the reader anything the answer itself does not.
 *
 * They stay in the store and on the wire: history replay, the failed-input
 * recovery lookup in CodeWorkbench and the transcript-limit accounting all still
 * see them. Only this view drops them. Failure and cancellation are kept,
 * because those are states a reader can act on.
 */
const HIDDEN_KINDS: ReadonlySet<CodeItemKind> = new Set<CodeItemKind>(['turn_started', 'turn_completed']);

/** A collapsed tool row against the same row expanded, for the virtualizer. */
const COLLAPSED_ROW_PX = 44;
const EXPANDED_ROW_PX = 260;
/** Same bound the scroll anchors use, for the same reason. */
const MAX_OPEN_ROWS = 64;

/**
 * A failed call opens itself, because the reader has to see why it failed. That
 * is a default, not a lock: once the reader has said what they want for this
 * row, their choice wins, including closing a failure they have already read.
 */
function isRowOpen(chosen: ReadonlyMap<string, boolean>, sessionKey: string, item: CodeItem): boolean {
    const choice = chosen.get(`${sessionKey}:${item.itemId}`);
    if (choice !== undefined) return choice;
    return item.status === 'error' && item.kind !== 'reasoning';
}

function ItemMarkdown({ item, identity, onOpenLocalFile }: { item: CodeItem; identity: string; onOpenLocalFile?: ((path: string) => void) | undefined }) {
    const text = useThrottledMarkdown(item.text ?? '', item.status !== 'running' && item.status !== 'pending', identity);
    if (!text.trim()) return <span className="code-plain-text">{text}</span>;
    return <Suspense fallback={<span className="code-plain-text">{text}</span>}>
        <MarkdownRenderer markdown={text} tableMode="linear" onLocalFileOpen={onOpenLocalFile} />
    </Suspense>;
}

export function CodeTranscriptItem({ item, provider, sessionKey, workingDir = '', onOpenLocalFile, expanded, onExpandedChange }: {
    item: CodeItem; provider: CodeProviderId; sessionKey: string; workingDir?: string;
    onOpenLocalFile?: ((path: string) => void) | undefined;
    expanded?: boolean;
    onExpandedChange?: ((itemId: string, open: boolean) => void) | undefined;
}) {
    const tool = item.kind === 'tool_call' || item.kind === 'file_change';
    const reasoning = item.kind === 'reasoning';
    const assistant = item.kind === 'assistant_message';
    const user = item.kind === 'user_message';
    const status = codeItemStatus(item);
    // A completed turn should read as prose, not as a status board: only
    // states the reader can act on are worth a visible badge.
    const note = noteworthyStatus(item);
    const unsent = item.itemId === PENDING_USER_ITEM_ID;
    // The transcript owns the disclosure, because the virtualizer unmounts rows
    // and per-row state would be lost on scroll. Rendered standalone (tests, a
    // future embed) it falls back to the same failure default.
    const open = expanded ?? (item.status === 'error' && item.kind !== 'reasoning');
    const running = item.status === 'running' || item.status === 'pending';
    // The verb already says the call is in flight; a second badge saying
    // "Running" next to "Reading src/app.ts" is the same fact twice. Failure
    // and cancellation still get a word, because those change what to do next.
    const toolNote = note === 'Running' || note === 'Pending' ? null : note;
    const label = user ? 'You' : assistant ? CODE_RUNTIME_LABELS[provider] : reasoning ? 'Reasoning'
        : item.kind === 'turn_started' ? 'Turn started' : item.kind === 'session_runtime' ? 'Runtime'
            : item.kind === 'permission_request' ? 'Permission record' : item.kind === 'notice' ? 'Notice' : status;
    return <article className={`code-message code-message-${tool ? 'tool' : assistant ? 'assistant' : user ? 'user' : 'system'} is-${item.status}${unsent ? ' is-unsent' : ''}`}
        data-code-item-id={item.itemId} aria-label={`${label} · ${status}`}>
        {tool ? <details className={`code-tool-card code-tool-${item.status}`} open={open}
            onToggle={event => onExpandedChange?.(item.itemId, event.currentTarget.open)}>
            <summary className="code-tool-summary"><span className="code-tool-chevron" aria-hidden="true">›</span>
                <span className={`code-tool-name${running ? ' code-tool-name-running' : ''}`}>{toolSummary(item, workingDir)}</span>
                {toolNote && <span className="code-tool-status">{toolNote}</span>}</summary>
            {/* Built only while open: a collapsed call's output can be megabytes,
                and constructing it costs the same whether or not it is painted. */}
            {open && <>
                {item.tool?.detail !== undefined && <p className="code-tool-text">{item.tool.detail}</p>}
                {item.tool?.input !== undefined && <section className="code-tool-section"><span className="code-tool-section-label">Input</span><pre className="code-tool-args">{item.tool.input}</pre></section>}
                {item.tool?.output !== undefined && <section className="code-tool-section"><span className="code-tool-section-label">Output</span><pre className="code-tool-output">{item.tool.output}</pre></section>}
                {item.text !== undefined && <pre className="code-tool-text">{item.text}</pre>}
            </>}
        </details> : reasoning ? <details className="code-thinking" open={open}
            onToggle={event => onExpandedChange?.(item.itemId, event.currentTarget.open)}>
            <summary className={`code-thinking-summary${item.status === 'running' ? ' code-tool-name-running' : ''}`}>{item.status === 'running' ? 'Thinking…' : 'Reasoning'}</summary>
            {open && <div className="code-thinking-text">{item.text}</div>}
        </details> : <>
            <span className="code-message-role">{label}{assistant && item.phase === 'commentary' ? ' · Commentary' : ''}
                {note && ` · ${unsent ? 'Sending' : note}`}</span>
            <div className="code-message-text">{assistant ? <ItemMarkdown item={item} identity={`${sessionKey}:${item.itemId}`} onOpenLocalFile={onOpenLocalFile} />
                : <span className="code-plain-text">{item.text ?? item.permission?.title ?? ''}</span>}</div>
            {item.permission?.detail && <p className="code-plain-text">{item.permission.detail}</p>}
        </>}
        {(assistant || reasoning) && (item.status === 'cancelled' || item.status === 'error') && <span className="code-partial-label">Partial output · {status}</span>}
        {item.truncation && <p className="code-truncation" role="note">Output truncated: {item.truncation.storedChars.toLocaleString()} of {item.truncation.sourceChars.toLocaleString()} characters retained.</p>}
    </article>;
}

export function CodeTranscript({ items, provider, sessionKey, workingDir, loading, hasOlderHistory, loadOlderHistory, permissionCount, onOpenLocalFile }: {
    items: CodeItem[]; provider: CodeProviderId; sessionKey: string; workingDir: string; loading: boolean;
    hasOlderHistory: boolean; loadOlderHistory(): Promise<void>; permissionCount: number;
    onOpenLocalFile?: ((path: string) => void) | undefined;
}) {
    const transcriptRef = useRef<HTMLDivElement>(null);
    const visible = useMemo(() => items.filter(item => !HIDDEN_KINDS.has(item.kind)), [items]);
    const itemsRef = useRef(visible); itemsRef.current = visible;
    // What the reader chose, which is not the same as what is open: a failed
    // call opens itself, so "not in the map" and "the reader closed it" have to
    // be different states or the auto-open reopens it on the next render.
    // Scoped by session so the reserved pending-user id cannot carry one
    // session's disclosure into another, and bounded so a long-lived tab does
    // not accumulate ids for sessions it will never show again.
    const [openRows, setOpenRows] = useState<ReadonlyMap<string, boolean>>(() => new Map());
    const [historyPending, setHistoryPending] = useState(false);
    const [historyError, setHistoryError] = useState<{ sessionKey: string; message: string } | null>(null);
    const historyGuard = useRef(false);
    const firstId = visible[0]?.itemId;
    const getItemKey = useCallback((index: number) => `${sessionKey}:${itemsRef.current[index]?.itemId ?? index}`, [sessionKey, firstId]);
    const estimateSize = useCallback((index: number) => {
        const item = itemsRef.current[index];
        const collapsible = item?.kind === 'tool_call' || item?.kind === 'file_change' || item?.kind === 'reasoning';
        // A collapsible row is one line until someone opens it. Estimating an
        // open row at one line is what makes the scrollbar disagree with the
        // content, so the estimate has to follow the disclosure.
        if (!collapsible) return 64 + Math.min(420, (item?.text?.length ?? 0) / 6);
        return item && isRowOpen(openRows, sessionKey, item) ? EXPANDED_ROW_PX : COLLAPSED_ROW_PX;
    }, [openRows, sessionKey]);
    const virtual = useCodeTranscriptVirtualRows({ count: visible.length, resetKey: sessionKey, scrollElementRef: transcriptRef, getItemKey, estimateSize });
    const { showJump, jumpToLatest } = useCodeTranscriptScroll({ items: visible, sessionKey, transcriptRef, virtual });
    const setExpanded = useCallback((itemId: string, open: boolean) => {
        const key = `${sessionKey}:${itemId}`;
        setOpenRows(current => {
            if (current.get(key) === open) return current;
            const next = new Map(current);
            next.delete(key); next.set(key, open);
            // Same bound as the scroll anchors: remembering every row a reader
            // ever touched is not worth an unbounded map. Re-inserting above
            // keeps the row just acted on newest, so it is never the one evicted.
            if (next.size > MAX_OPEN_ROWS) {
                const oldest = next.keys().next().value;
                if (oldest !== undefined) next.delete(oldest);
            }
            return next;
        });
        // The virtualizer measured this row at its old height, and nothing about
        // a toggle changes item count or identity, so no option update reaches
        // it. Hand it the new estimate directly; it corrects the scroll offset
        // when the row sits above the viewport.
        const index = itemsRef.current.findIndex(entry => entry.itemId === itemId);
        if (index >= 0) virtual.resizeItem(index, open ? EXPANDED_ROW_PX : COLLAPSED_ROW_PX);
    }, [sessionKey, virtual]);
    async function older() {
        if (historyGuard.current) return;
        historyGuard.current = true; setHistoryPending(true); setHistoryError(null);
        try { await loadOlderHistory(); }
        catch (err) { setHistoryError({ sessionKey, message: err instanceof Error ? err.message : String(err) }); }
        finally { historyGuard.current = false; setHistoryPending(false); }
    }
    function keyboard(event: KeyboardEvent<HTMLDivElement>) {
        if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
        const node = transcriptRef.current;
        if (!node) return;
        const page = Math.max(160, node.clientHeight * 0.78);
        if (['j', 'd', 'PageDown'].includes(event.key)) { event.preventDefault(); node.scrollBy({ top: page, behavior: 'auto' }); }
        else if (['k', 'u', 'PageUp'].includes(event.key)) { event.preventDefault(); node.scrollBy({ top: -page, behavior: 'auto' }); }
        else if (event.key === 'End') { event.preventDefault(); jumpToLatest(); }
        else if (event.key === 'Home') { event.preventDefault(); node.scrollTo({ top: 0, behavior: 'auto' }); }
    }
    return <>
        <div className="code-transcript-controls">
            {hasOlderHistory && <button type="button" disabled={historyPending || loading} onClick={() => void older()}>{historyPending ? 'Loading history…' : 'Load older history'}</button>}
            {showJump && <button type="button" onClick={jumpToLatest}>Jump to latest</button>}
            {permissionCount > 0 && <button type="button" onClick={() => document.getElementById('code-pending-permissions')?.focus()}>Jump to permissions ({permissionCount})</button>}
            {historyError?.sessionKey === sessionKey && <span className="code-action-error" role="alert">{historyError.message}</span>}
        </div>
        <div ref={transcriptRef} className="code-transcript" role="log" aria-label="Code transcript" aria-live="off" tabIndex={0} onKeyDown={keyboard}>
            {!visible.length ? <div className="code-transcript-empty"><p>{loading ? 'Loading conversation…' : 'Type a prompt below to start this conversation.'}</p>
                <p className="code-transcript-cwd">Workspace: {workingDir || 'not set'}</p></div>
                : <div className="code-transcript-virtual-spacer" style={{ height: virtual.totalSize }}>
                    {virtual.virtualItems.map(row => {
                        const item = visible[row.index];
                        return item ? <div key={row.key} ref={virtual.measureElement} className="code-transcript-virtual-row"
                            data-code-transcript-idx={row.index} style={{ transform: `translateY(${row.start}px)` }}>
                            <CodeTranscriptItem item={item} provider={provider} sessionKey={sessionKey}
                                workingDir={workingDir} onOpenLocalFile={onOpenLocalFile}
                                expanded={isRowOpen(openRows, sessionKey, item)}
                                onExpandedChange={setExpanded} />
                        </div> : null;
                    })}
                </div>}
        </div>
    </>;
}

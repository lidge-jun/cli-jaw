// ── UI Utilities ──
import { state } from './state.js';
import { renderMarkdown, escapeHtml, stripOrchestration, linkifyFilePaths } from './render.js';
import { renderMermaidBlocks } from './render.js';
import { generateId } from './uuid.js';
import { getAppName } from './features/appname.js';
import { getAgentAvatarMarkup, getUserAvatarMarkup } from './features/avatar.js';
import { t } from './features/i18n.js';
import { api } from './api.js';
import { cacheMessages, getCachedMessages, appendCachedMessage, upsertMessage, setMessageScope, getScopedMessages } from './features/idb-cache.js';
import { getVirtualScroll, VS_THRESHOLD, type RestoreReason, type VirtualItem } from './virtual-scroll.js';
import { bootstrapVirtualHistory, type VirtualHistoryBootstrapDeps } from './virtual-scroll-bootstrap.js';
import { createStreamRenderer, appendChunk, finalizeStream, hydrateStreamRenderer, type StreamState } from './streaming-render.js';
import { activateWidgets } from './diagram/iframe-renderer.js';
import { renderLiveToolActivity, cleanupToolElements, type ToolLogEntry } from './features/tool-ui.js';
import { initMessageActions } from './features/message-actions.js';
import { addSystemMsg, addMessage, removeSkeleton } from './features/chat-messages.js';
import { buildLazyVirtualMessageItem } from './features/message-item-html.js';
import { loadMessages } from './features/message-history.js';
import { isChatNearBottom, reconcileChatBottomAfterLayout, showChatRestoreIndicator, hideChatRestoreIndicator, hideChatRestoreIndicatorAfterSettle, reconcileChatBottomAfterRestore, scrollToBottom, ensureScrollTracking, canFollowAfterRestore, markFollowingBottom } from './features/chat-scroll.js';
import { currentProcessBlockFromDom, hasAgentToolBlock, normalizeAgentToolBlocks, removeAgentToolBlocks, serializeProcessStepsForToolLog } from './features/process-block-dom.js';
import { mergeExplicitAndLiveToolLogs, normalizeMessageToolLog, parseToolLog, sanitizedToolLogEntries, sanitizedToolLogJson, sanitizedToolLogJsonFromEntries, toProcessSteps, type ActiveRunSnapshot, type MessageItem, type QueuedOverlayItem } from './features/process-log-adapter.js';
import { setStatus, updateQueueBadge, updateStatMsgs, loadStats } from './features/ui-status.js';
import { ICONS, emojiToIcon, emojiToStatus, isCompletionEmoji } from './icons.js';
import { providerIcon } from './provider-icons.js';
import { findRunningProcessStepMatch } from './features/process-step-match.js';
import {
    parseToolLogBounded,
    sanitizeToolLogForDurableStorage,
    serializeSanitizedToolLog,
    type SanitizedToolLogEntry,
} from '../../src/shared/tool-log-sanitize.js';
import {
    createProcessBlock,
    addStep,
    replaceStep,
    updateStepStatus,
    collapseBlock,
    stopBlockTicker,
    buildProcessBlockHtml,
    getStoredProcessStepDetail,
    mergeStoredProcessStepDetail,
    setStoredProcessStepDetail,
    processStepMetaFromStore,
    releaseProcessBlockDetails,
    type ProcessStep,
    type ProcessBlockState,
} from './features/process-block.js';


export {
    setStatus, updateQueueBadge, loadStats, loadMessages,
    addSystemMsg, addMessage,
    isChatNearBottom, reconcileChatBottomAfterLayout, showChatRestoreIndicator,
    hideChatRestoreIndicator, hideChatRestoreIndicatorAfterSettle, reconcileChatBottomAfterRestore,
    scrollToBottom,
};

function getAgentIcon(_cli?: string | null): string {
    return getAgentAvatarMarkup();
}

declare global {
    interface Window {
        __jawProcessBlockLayoutMutation?: (anchor: Element | null, mutate: () => void) => void;
    }
}

export function cleanupToolActivity(): void {
    if (state.currentProcessBlock) releaseProcessBlockDetails(state.currentProcessBlock);
    if (state.currentAgentDiv instanceof HTMLElement) releaseProcessBlockDetails(state.currentAgentDiv);
    cleanupToolElements();
    stopBlockTicker();
    state.currentAgentDiv = null;
    state.currentProcessBlock = null;
    currentStream = null;
}

export function showLiveToolActivity(label: string): void {
    removeSkeleton();
    if (!state.currentAgentDiv || !state.currentAgentDiv.isConnected) {
        state.currentAgentDiv = addMessage('agent', '');
    }
    renderLiveToolActivity(state.currentAgentDiv as HTMLElement, label);
    scrollToBottom();
}

export function showProcessStep(step: ProcessStep): void {
    removeSkeleton();
    if (!state.currentAgentDiv || !state.currentAgentDiv.isConnected) {
        state.currentAgentDiv = addMessage('agent', '');
        state.currentProcessBlock = null;
    }
    const agentDiv = state.currentAgentDiv;
    normalizeAgentToolBlocks(agentDiv);
    if (!state.currentProcessBlock) {
        const body = agentDiv.querySelector('.agent-body') as HTMLElement;
        if (body) {
            state.currentProcessBlock = currentProcessBlockFromDom(agentDiv);
        }
        if (!state.currentProcessBlock && body) {
            removeAgentToolBlocks(agentDiv);
            state.currentProcessBlock = createProcessBlock(body);
        }
    }
    if (state.currentProcessBlock) {
        const rawIcon = step.rawIcon || step.icon;
        // Completion detection: prefer semantic status field, fall back to emoji check
        const resolvedStatus = step.status || emojiToStatus(step.icon) || 'running';
        if (resolvedStatus === 'done' || resolvedStatus === 'error') {
            // Prefer matching by stepRef (stable correlation), fall back to label
            const match = findRunningProcessStepMatch(state.currentProcessBlock.steps, step);
            if (match) {
                step.icon = emojiToIcon(step.icon);
                const detailPreview = step.type === 'thinking'
                    ? setStoredProcessStepDetail(match.id, step.detail)
                    : mergeStoredProcessStepDetail(match.id, step.detail);
                replaceStep(state.currentProcessBlock, match.id, {
                    ...match,
                    ...step,
                    id: match.id,
                    rawIcon,
                    detail: detailPreview,
                    detailPreview,
                    label: step.label || match.label,
                    status: resolvedStatus,
                });
                scrollToBottom();
                return;
            }
            if (step.stepRef && (resolvedStatus === 'done' || resolvedStatus === 'error')) {
                const existingDone = [...state.currentProcessBlock.steps].reverse()
                    .find(s => s.stepRef === step.stepRef && (s.status === 'done' || s.status === 'error'));
                if (existingDone) {
                    step.icon = emojiToIcon(step.icon);
                    const detailPreview = step.type === 'thinking'
                        ? setStoredProcessStepDetail(existingDone.id, step.detail)
                        : mergeStoredProcessStepDetail(existingDone.id, step.detail);
                    replaceStep(state.currentProcessBlock, existingDone.id, {
                        ...existingDone,
                        ...step,
                        id: existingDone.id,
                        rawIcon,
                        status: resolvedStatus,
                        detail: detailPreview,
                        detailPreview,
                    });
                    scrollToBottom();
                    return;
                }
            }
        }
        if (step.stepRef && resolvedStatus === 'running') {
            const existingRunning = [...state.currentProcessBlock.steps].reverse()
                .find(s => s.stepRef === step.stepRef && s.status === 'running');
            if (existingRunning) {
                step.rawIcon = rawIcon;
                step.icon = emojiToIcon(step.icon);
                const detailPreview = setStoredProcessStepDetail(existingRunning.id, step.detail);
                replaceStep(state.currentProcessBlock, existingRunning.id, {
                    ...existingRunning,
                    ...step,
                    id: existingRunning.id,
                    rawIcon,
                    status: 'running',
                    detail: detailPreview,
                    detailPreview,
                    label: step.label || existingRunning.label,
                });
                scrollToBottom();
                return;
            }
        }
        // Dedupe: detail이 있는 재broadcast → 같은 label+type의 detail 없는 유령 교체
        if (step.detail) {
            const ghost = [...state.currentProcessBlock.steps].reverse()
                .find(s => s.status === 'running'
                    && s.label === step.label
                    && s.type === step.type
                    && Boolean(s.isEmployee) === Boolean(step.isEmployee)
                    && !s.detail);
            if (ghost) {
                replaceStep(state.currentProcessBlock, ghost.id, step);
                scrollToBottom();
                return;
            }
        }
        // Convert emoji icon to SVG before adding step
        step.rawIcon = rawIcon;
        step.icon = emojiToIcon(step.icon);
        addStep(state.currentProcessBlock, step);
    }
    scrollToBottom();
}

let currentStream: StreamState | null = null;

const ACTIVE_RUN_HYDRATED_ATTR = 'data-active-run-hydrated';

function removeStaleHydratedActiveRuns(keep?: HTMLElement | null): void {
    document.querySelectorAll<HTMLElement>(`[${ACTIVE_RUN_HYDRATED_ATTR}="true"]`).forEach(el => {
        if (keep && el === keep) return;
        el.remove();
    });
}

function ensureActiveRunMessage(cli?: string | null): HTMLElement {
    const existing = state.currentAgentDiv && state.currentAgentDiv.isConnected
        ? state.currentAgentDiv as HTMLElement
        : null;
    removeStaleHydratedActiveRuns(existing);
    const div = existing || addMessage('agent', '', cli || null);
    div.setAttribute(ACTIVE_RUN_HYDRATED_ATTR, 'true');
    return div;
}

/**
 * Queued items are surfaced exclusively by the pending-queue panel
 * (renderPendingQueue) — they do NOT appear as chat bubbles until they
 * actually start running. This function exists only to clean up legacy
 * overlay bubbles from older builds that may still be in the DOM after
 * a soft reload, and to drop stale snapshots silently.
 */
export function applyQueuedOverlay(_items: QueuedOverlayItem[] = []): void {
    document.querySelectorAll('[data-queued-overlay="true"]').forEach(el => el.remove());
}

export function hydrateActiveRun(snapshot?: ActiveRunSnapshot | null): void {
    if (!snapshot?.running) {
        removeStaleHydratedActiveRuns();
        return;
    }
    cleanupToolElements();
    removeSkeleton();
    state.currentAgentDiv = ensureActiveRunMessage(snapshot.cli || null);
    state.currentProcessBlock = null;
    const body = state.currentAgentDiv.querySelector('.agent-body') as HTMLElement | null;
    const snapshotToolLog = sanitizedToolLogEntries(snapshot.toolLog || []);
    if (body && snapshotToolLog.length) {
        normalizeAgentToolBlocks(state.currentAgentDiv);
        removeAgentToolBlocks(state.currentAgentDiv);
        const pb = createProcessBlock(body);
        for (const tool of toProcessSteps(snapshotToolLog, snapshot.startedAt)) addStep(pb, tool);
        state.currentProcessBlock = pb;
    } else {
        normalizeAgentToolBlocks(state.currentAgentDiv);
        state.currentProcessBlock = currentProcessBlockFromDom(state.currentAgentDiv);
    }
    const content = state.currentAgentDiv.querySelector('.msg-content') as HTMLElement | null;
    if (content) {
        currentStream = hydrateStreamRenderer(content, snapshot.text || '');
    }
}

export function appendAgentText(text: string): void {
    if (!text) return;
    removeSkeleton();
    if (!state.currentAgentDiv || !state.currentAgentDiv.isConnected) {
        state.currentAgentDiv = addMessage('agent', '');
        currentStream = null;
    }
    const content = (state.currentAgentDiv as HTMLElement)?.querySelector('.msg-content');
    if (content) {
        if (!currentStream) currentStream = createStreamRenderer(content as HTMLElement);
        appendChunk(currentStream, text);
    }
    scrollToBottom();
}

let lastFinalizeTs = 0;

function clearMermaidTransientState(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('.mermaid-pending').forEach(el => {
        delete el.dataset['mermaidQueued'];
        delete el.dataset['mermaidQueuedAt'];
    });
}

export function finalizeAgent(text: string, toolLog?: ToolLogEntry[]): void {
    // Guard: prevent double-render when both agent_done + orchestrate_done fire
    const now = Date.now();
    if (!state.currentAgentDiv && now - lastFinalizeTs < 500) return;

    cleanupToolElements();
    removeSkeleton();
    if (state.currentAgentDiv) normalizeAgentToolBlocks(state.currentAgentDiv);
    const liveToolLog = serializeProcessStepsForToolLog(
        state.currentProcessBlock ?? state.currentAgentDiv,
        true,
    );
    const explicitToolLog = Array.isArray(toolLog) ? toolLog : [];
    const durableToolLog = sanitizedToolLogEntries(
        mergeExplicitAndLiveToolLogs(explicitToolLog, liveToolLog),
    );
    const durableToolLogJson = sanitizedToolLogJsonFromEntries(durableToolLog);
    const hadProcessBlock =
        Boolean(state.currentProcessBlock) ||
        Boolean(state.currentAgentDiv && hasAgentToolBlock(state.currentAgentDiv));
    if (state.currentProcessBlock) {
        collapseBlock(state.currentProcessBlock);
        state.currentProcessBlock = null;
    }
    const hasTools = durableToolLog.length > 0;
    if (text || hasTools) {
        if (!state.currentAgentDiv || !state.currentAgentDiv.isConnected) {
            state.currentAgentDiv = addMessage('agent', '');
        }
        state.currentAgentDiv.removeAttribute(ACTIVE_RUN_HYDRATED_ATTR);
        const content = (state.currentAgentDiv as HTMLElement)?.querySelector('.msg-content');
        // Live stream is preview-only; agent_done text stays authoritative.
        const streamedText = currentStream ? finalizeStream(currentStream, true) : '';
        const finalText = text || streamedText;
        currentStream = null;
        if (content) content.innerHTML = renderMarkdown(finalText);
        if (hasTools && state.currentAgentDiv && !hadProcessBlock && !hasAgentToolBlock(state.currentAgentDiv)) {
            const contentEl = state.currentAgentDiv.querySelector('.msg-content') as HTMLElement | null;
            if (contentEl) {
                contentEl.insertAdjacentHTML(
                    'beforebegin',
                    buildProcessBlockHtml(toProcessSteps(durableToolLog), true),
                );
            }
        }
        if (state.currentAgentDiv) normalizeAgentToolBlocks(state.currentAgentDiv);
        if (content) content.setAttribute('data-raw', stripOrchestration(finalText));
        if (content) activateWidgets(content as HTMLElement);

        const vs = getVirtualScroll();
        const willPromoteToVirtualScroll = !!(
            vs.active && state.currentAgentDiv && state.currentAgentDiv.isConnected
        );

        // Phase 127-F5/F9: kick off mermaid render immediately for direct DOM only.
        // If this message will be promoted into Virtual Scroll, let the mounted VS
        // clone render via onPostRender; otherwise we can queue a soon-detached node.
        if (content && !willPromoteToVirtualScroll) {
            void renderMermaidBlocks(content as HTMLElement, { immediate: true });
        }

        // Promote streaming div from real DOM into VS if active.
        // Revert activated widgets back to pending state so VS can
        // re-activate them after recreating the DOM from stored HTML.
        if (willPromoteToVirtualScroll) {
            const div = state.currentAgentDiv;
            clearMermaidTransientState(div);
            div.querySelectorAll('.diagram-widget').forEach(widget => {
                const encoded = (widget as HTMLElement).dataset['widgetHtml'];
                if (!encoded) return;
                const pending = document.createElement('div');
                pending.className = 'diagram-widget-pending';
                pending.dataset['diagramHtml'] = encoded;
                widget.replaceWith(pending);
            });
            if (durableToolLogJson) {
                vs.appendItem(buildLazyVirtualMessageItem({
                    role: 'assistant',
                    content: finalText,
                    cli: null,
                    tool_log: durableToolLogJson,
                }, vs.count));
                releaseProcessBlockDetails(div);
            } else {
                vs.appendLiveItem(div);
            }
            div.remove();
        }

        // Cache agent response for offline (use finalText to capture stream-only responses)
        if (finalText) upsertMessage({
            role: 'assistant',
            content: finalText,
            tool_log: durableToolLogJson,
            timestamp: Date.now(),
        }).catch(() => {});
    }
    currentStream = null;
    state.currentAgentDiv = null;
    lastFinalizeTs = Date.now();
    setStatus('idle');
    loadStats();
}

export function switchTab(name: string, targetBtn: Element): void {
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const tabMap: Record<string, string> = { agents: 'tabAgents', settings: 'tabSettings', skills: 'tabSkills' };
    document.getElementById(tabMap[name])?.classList.add('active');
    if (targetBtn) {
        targetBtn.classList.add('active');
        targetBtn.setAttribute('aria-selected', 'true');
    }
    // Lazy-load tab content
    if (name === 'settings') { import('./features/settings.js').then(m => m.loadSettings()); }
    if (name === 'agents') { import('./features/employees.js').then(m => m.loadEmployees()); }
    if (name === 'skills') { import('./features/skills.js').then(m => m.loadSkills()); }
}

export function handleSave(): void {
    const isSettings = document.getElementById('tabSettings')?.classList.contains('active');
    if (isSettings) {
        import('./features/settings.js').then(m => m.savePerCli());
    } else {
        import('./features/settings.js').then(m => m.updateSettings());
    }
}

// loadMemory removed — #memoryList element does not exist in HTML.
// Memory is now handled by features/memory.ts via the modal UI.

// ── Message action delegation ──
export function initMsgCopy(): void {
    initMessageActions({ onStatus: addSystemMsg });
}

import { api } from '../api.js';
import { renderMarkdown, linkifyFilePaths } from '../render.js';
import { renderMermaidBlocks } from '../render.js';
import { getVirtualScroll, VS_THRESHOLD, type VirtualItem } from '../virtual-scroll.js';
import { bootstrapVirtualHistory, type VirtualHistoryBootstrapDeps } from '../virtual-scroll-bootstrap.js';
import { activateWidgets } from '../diagram/iframe-renderer.js';
import { ICONS } from '../icons.js';
import { t } from './i18n.js';
import { cacheMessages, getScopedMessages, setMessageScope } from './idb-cache.js';
import { addMessage, addSystemMsg, showEmptyState } from './chat-messages.js';
import { buildLazyVirtualMessageItem } from './message-item-html.js';
import { addStep, buildProcessBlockHtml, collapseBlock, createProcessBlock } from './process-block.js';
import { hasAgentToolBlock, normalizeAgentToolBlocks } from './process-block-dom.js';
import { normalizeMessageToolLog, parseToolLog, toProcessSteps, type MessageItem } from './process-log-adapter.js';
import { canFollowAfterRestore, ensureScrollTracking, markFollowingBottom } from './chat-scroll.js';
import { updateStatMsgs } from './ui-status.js';

export function buildVirtualHistoryItems(msgs: MessageItem[]): VirtualItem[] {
    return msgs.map((m, index) => buildLazyVirtualMessageItem(normalizeMessageToolLog(m), index));
}

export function registerVirtualScrollCallbacks(vs: ReturnType<typeof getVirtualScroll>): void {
    vs.onLazyRender = (targets: HTMLElement[]) => {
        for (const el of targets) {
            if (!el.classList.contains('lazy-pending')) continue;
            const raw = el.getAttribute('data-raw') || '';
            const msgEl = el.closest('.msg-agent') as HTMLElement | null;
            const body = msgEl?.querySelector('.agent-body') as HTMLElement | null;
            const rawToolLog = body?.dataset['toolLog'] || '';
            if (msgEl && body && rawToolLog && !hasAgentToolBlock(msgEl)) {
                const tools = parseToolLog(rawToolLog);
                if (tools.length > 0) {
                    el.insertAdjacentHTML('beforebegin', buildProcessBlockHtml(toProcessSteps(tools), true));
                }
                delete body.dataset['toolLog'];
                normalizeAgentToolBlocks(msgEl);
            }
            el.innerHTML = raw ? renderMarkdown(raw) : '';
            el.classList.remove('lazy-pending');
            activateWidgets(el);
            void renderMermaidBlocks(el, { immediate: true });
        }
    };
    vs.onPostRender = (viewport: HTMLElement) => {
        activateWidgets(viewport);
        linkifyFilePaths(viewport);
        void renderMermaidBlocks(viewport, { immediate: true });
    };
}

export function makeBootstrapDeps(
    vs: ReturnType<typeof getVirtualScroll>,
    options: { forceInitialBottom?: boolean; restoreIndex?: number | null } = {},
): VirtualHistoryBootstrapDeps {
    const shouldFollowBottom = options.forceInitialBottom ? () => true : canFollowAfterRestore;
    return {
        registerCallbacks: () => registerVirtualScrollCallbacks(vs),
        setItems: (items, opts) => vs.setItems(items, opts),
        activateIfNeeded: (toBottom) => vs.activateIfNeeded(toBottom),
        scrollToBottom: () => vs.scrollToBottom(),
        scrollToIndex: (index) => vs.scrollToIndex(index),
        shouldFollowBottom,
        restoreIndex: options.restoreIndex ?? null,
        onBeforeVirtualHistoryBootstrap: () => { ensureScrollTracking(); },
        onAfterVirtualHistoryBottomed: () => { markFollowingBottom(); },
    };
}

function hydrateSmallHistory(messages: MessageItem[]): void {
    messages.forEach(m => {
        const div = addMessage(m.role === 'assistant' ? 'agent' : m.role, m.content, m.cli);
        if (m.role === 'assistant' && m.tool_log) {
            const tools = parseToolLog(m.tool_log);
            if (tools.length > 0) {
                const body = div.querySelector('.agent-body') as HTMLElement;
                if (body) {
                    const pb = createProcessBlock(body);
                    for (const tool of toProcessSteps(tools)) addStep(pb, tool);
                    collapseBlock(pb);
                }
            }
        }
    });
}

export async function loadMessages(): Promise<void> {
    const vs = getVirtualScroll();
    const chatEl = document.getElementById('chatMessages');
    try {
        const settings = await api<{ workingDir?: string }>('/api/settings');
        if (settings?.workingDir) setMessageScope(settings.workingDir);
    } catch { /* localStorage fallback already initialized currentScope */ }
    const msgs = await api<MessageItem[]>('/api/messages');
    if (msgs !== null) {
        const safeMsgs = msgs.map(normalizeMessageToolLog);
        const hadRenderedHistory = Boolean(chatEl?.querySelector('.msg')) || vs.active;
        const savedIndex = vs.active ? vs.firstVisibleIndex() : null;
        vs.clear();
        if (chatEl) chatEl.innerHTML = '';
        if (safeMsgs.length >= VS_THRESHOLD) {
            bootstrapVirtualHistory(buildVirtualHistoryItems(safeMsgs), makeBootstrapDeps(vs, {
                forceInitialBottom: !hadRenderedHistory,
                restoreIndex: hadRenderedHistory ? savedIndex : null,
            }));
        } else {
            hydrateSmallHistory(safeMsgs);
        }
        cacheMessages(safeMsgs.map(m => ({
            role: m.role, content: m.content, cli: m.cli ?? null, tool_log: m.tool_log ?? null, timestamp: Date.now(),
        }))).catch(() => {});
        updateStatMsgs(safeMsgs.length);
        showEmptyState();
        return;
    }
    if (chatEl && chatEl.children.length > 0) {
        showEmptyState();
        return;
    }
    const cached = await getScopedMessages();
    if (cached.length > 0) {
        const safeCached = (cached as MessageItem[]).map(normalizeMessageToolLog);
        if (safeCached.length >= VS_THRESHOLD) {
            bootstrapVirtualHistory(buildVirtualHistoryItems(safeCached), makeBootstrapDeps(vs, {
                forceInitialBottom: true,
            }));
        } else {
            hydrateSmallHistory(safeCached);
        }
        addSystemMsg(`${ICONS.warning} ${t('ui.offline.banner')}`);
        updateStatMsgs(safeCached.length);
    }
    showEmptyState();
}

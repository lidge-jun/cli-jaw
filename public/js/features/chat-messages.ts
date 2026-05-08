import { renderMarkdown, escapeHtml, sanitizeHtml, stripOrchestration, linkifyFilePaths } from '../render.js';
import { renderMermaidBlocks } from '../render.js';
import { generateId } from '../uuid.js';
import { state } from '../state.js';
import { getVirtualScroll, VS_THRESHOLD } from '../virtual-scroll.js';
import { activateWidgets } from '../diagram/iframe-renderer.js';
import { getAppName } from './appname.js';
import { getAgentAvatarMarkup, getUserAvatarMarkup } from './avatar.js';
import { t } from './i18n.js';
import { renderMessageActionsHtml } from './message-actions.js';
import { normalizeAgentToolBlocks } from './process-block-dom.js';
import { scrollToBottom } from './chat-scroll.js';

function getAgentIcon(_cli?: string | null): string {
    return getAgentAvatarMarkup();
}

export function showSkeleton(): void {
    const container = document.getElementById('chatMessages');
    if (!container || container.querySelector('.skeleton-msg')) return;
    if (state.currentAgentDiv && state.currentAgentDiv.isConnected) return;
    hideEmptyState();
    const skel = document.createElement('div');
    skel.className = 'skeleton-msg';
    skel.innerHTML = '<div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div>';
    container.appendChild(skel);
    scrollToBottom();
}

export function removeSkeleton(): void {
    document.querySelectorAll('.skeleton-msg').forEach(el => el.remove());
}

export function hideEmptyState(): void {
    document.getElementById('emptyState')?.classList.remove('visible');
}

export function showEmptyState(): void {
    const container = document.getElementById('chatMessages');
    if (container && container.children.length === 0) {
        document.getElementById('emptyState')?.classList.add('visible');
    }
}

export function addSystemMsg(text: string, extraClass?: string, type?: string): void {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const vs = getVirtualScroll();
    hideEmptyState();
    const div = document.createElement('div');
    const typeClass = type ? ` msg-type-${type}` : '';
    div.className = 'msg msg-system' + typeClass + (extraClass ? ' ' + extraClass : '');
    div.innerHTML = sanitizeHtml(text);
    if (vs.active) {
        vs.appendLiveItem(div);
    } else {
        container.appendChild(div);
    }
    scrollToBottom();
}

export function formatUserPrompt(text: string): string {
    const multiMatch = text.match(/^\[(?:사용자가 파일 (\d+)개를 보냈습니다|User sent (\d+) files)\]/);
    if (multiMatch) {
        const count = multiMatch[1] || multiMatch[2];
        const userMsgMatch = text.match(/(?:사용자 메시지|User message): (.+)$/s);
        const userMsg = userMsgMatch ? ' ' + userMsgMatch[1].trim() : '';
        return `📎 [${count} files]${userMsg}`;
    }
    const fileMatch = text.match(/^\[(?:사용자가 파일을 보냈습니다|User sent a file): ([^\]]+)\]/);
    if (fileMatch) {
        const fileName = fileMatch[1].split('/').pop() || fileMatch[1];
        const voiceMatch = text.match(/🎤\s*(.{0,80})/);
        const voicePart = voiceMatch ? `${t('chat.voice.label')} ` : '';
        const userMsgMatch = text.match(/(?:사용자 메시지|User message): (.+)$/s);
        const userMsg = userMsgMatch ? ' ' + userMsgMatch[1].trim() : '';
        return `${voicePart}📎 [${fileName}]${userMsg}`;
    }
    return text;
}

export function addMessage(role: string, text: string, cli?: string | null): HTMLDivElement {
    const container = document.getElementById('chatMessages');
    const vs = getVirtualScroll();
    hideEmptyState();
    removeSkeleton();
    const displayText = role === 'user' ? formatUserPrompt(text) : text;
    const rendered = renderMarkdown(displayText);
    const label = escapeHtml(role === 'user' ? t('msg.you') : getAppName());
    const div = document.createElement('div');
    const turnIndex = container ? container.querySelectorAll('.msg').length : null;
    const messageId = generateId();
    div.setAttribute('data-message-role', role);
    div.setAttribute('data-message-id', messageId);
    if (turnIndex !== null) div.setAttribute('data-turn-index', String(turnIndex));
    const port = Number(window.location.port);
    if (Number.isFinite(port) && port > 0) div.setAttribute('data-instance-id', `port:${port}`);
    const actions = renderMessageActionsHtml();
    if (role === 'agent') {
        div.className = 'msg msg-agent';
        div.innerHTML = `<div class="agent-icon" aria-hidden="true">${getAgentIcon(cli)}</div><div class="agent-body"><div class="msg-content">${rendered}</div>${actions}</div>`;
    } else {
        div.className = `msg msg-${role}`;
        div.innerHTML = `<div class="user-body"><div class="msg-label">${label}</div><div class="msg-content">${rendered}</div>${actions}</div><div class="user-icon" aria-hidden="true">${getUserAvatarMarkup()}</div>`;
    }
    const contentEl = div.querySelector('.msg-content');
    if (contentEl) contentEl.setAttribute('data-raw', stripOrchestration(text));
    const isStreamingPlaceholder = role === 'agent' && !text;
    if (vs.active && !isStreamingPlaceholder) {
        if (div.classList.contains('msg-agent')) normalizeAgentToolBlocks(div);
        vs.appendLiveItem(div);
    } else {
        container?.appendChild(div);
        activateWidgets(div);
        if (!vs.active && !isStreamingPlaceholder && container) {
            const msgCount = container.querySelectorAll('.msg').length;
            if (msgCount >= VS_THRESHOLD) {
                container.querySelectorAll('.msg').forEach(el => {
                    if (el.classList.contains('msg-agent')) normalizeAgentToolBlocks(el as HTMLElement);
                    vs.addItem(generateId(), el.outerHTML);
                });
                vs.onPostRender = (viewport: HTMLElement) => {
                    activateWidgets(viewport);
                    linkifyFilePaths(viewport);
                    void renderMermaidBlocks(viewport, { immediate: true });
                };
            }
        }
    }
    scrollToBottom(role === 'user');
    return div;
}

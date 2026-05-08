import { api } from '../api.js';
import { escapeHtml } from '../render.js';
import { ICONS } from '../icons.js';
import { bindToolItemInteractions } from './tool-ui.js';
import { bindProcessBlockInteractions } from './process-block.js';

type MessageActionSource = {
    role: string;
    messageId: string;
    turnIndex: number | null;
};

type MessageActionsOptions = {
    onStatus?: (message: string) => void;
};

type ReminderFromMessageResponse = {
    ok?: boolean;
    item?: { id?: string; title?: string };
    error?: string;
};

function currentPort(): number | null {
    const port = Number(window.location.port);
    if (Number.isFinite(port) && port > 0) return port;
    const match = window.location.pathname.match(/^\/i\/(\d+)/);
    return match ? Number(match[1]) : null;
}

function compactReminderTitle(text: string): string {
    const firstLine = text.split(/\r?\n/).map(line => line.trim()).find(Boolean);
    if (!firstLine) return 'Pinned reminder';
    return firstLine.length > 96 ? `${firstLine.slice(0, 93)}...` : firstLine;
}

function messageText(msg: Element): string {
    const content = msg.querySelector('.msg-content') as HTMLElement | null;
    return content?.getAttribute('data-raw') || content?.innerText || content?.textContent || '';
}

function parseTurnIndex(value: string | undefined): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sourcePayload(msg: HTMLElement, text: string): Record<string, unknown> {
    const port = currentPort();
    const messageId = msg.dataset['messageId'] || '';
    return {
        title: compactReminderTitle(text),
        notes: text,
        priority: 'normal',
        instanceId: msg.dataset['instanceId'] || (port ? `port:${port}` : 'browser'),
        messageId,
        turnIndex: parseTurnIndex(msg.dataset['turnIndex']),
        port,
        threadKey: window.location.pathname,
        sourceText: text,
    };
}

function setCopied(btn: HTMLElement): void {
    btn.classList.add('copied');
    btn.innerHTML = ICONS.checkSimple;
    setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = '';
    }, 600);
}

async function copyMessage(btn: HTMLElement): Promise<void> {
    const msg = btn.closest('.msg');
    if (!msg) return;
    await navigator.clipboard.writeText(messageText(msg));
    setCopied(btn);
}

async function pinMessage(btn: HTMLElement, options: MessageActionsOptions): Promise<void> {
    const msg = btn.closest('.msg') as HTMLElement | null;
    if (!msg) return;
    const text = messageText(msg).trim();
    if (!text) {
        options.onStatus?.('Cannot pin an empty message as a reminder.');
        return;
    }
    btn.setAttribute('aria-busy', 'true');
    btn.classList.add('is-pinning');
    try {
        const result = await api<ReminderFromMessageResponse>('/api/dashboard/reminders/from-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sourcePayload(msg, text)),
        });
        if (!result?.ok) throw new Error(result?.error || 'Reminder pin failed');
        btn.classList.add('is-pinned');
        options.onStatus?.(`Pinned reminder: ${result.item?.title || compactReminderTitle(text)}`);
    } catch (error) {
        options.onStatus?.(`Reminder pin failed: ${(error as Error).message}`);
    } finally {
        btn.classList.remove('is-pinning');
        btn.removeAttribute('aria-busy');
    }
}

function toggleToolGroup(target: HTMLElement): boolean {
    const summary = target.closest('.tool-group-summary') as HTMLElement | null;
    if (!summary) return false;
    const group = summary.closest('.tool-group');
    const details = summary.nextElementSibling as HTMLElement;
    if (group && details) {
        const isExpanding = !group.classList.contains('expanded');
        group.classList.toggle('expanded');
        details.classList.toggle('collapsed');
        summary.setAttribute('aria-expanded', isExpanding ? 'true' : 'false');
    }
    return true;
}

export function messageSourceAttributes(source: MessageActionSource): string {
    const attrs = [
        `data-message-role="${escapeHtml(source.role)}"`,
        `data-message-id="${escapeHtml(source.messageId)}"`,
    ];
    if (source.turnIndex !== null) attrs.push(`data-turn-index="${source.turnIndex}"`);
    if (typeof window !== 'undefined') {
        const port = currentPort();
        if (port) attrs.push(`data-instance-id="port:${port}"`);
    }
    return attrs.join(' ');
}

export function renderMessageActionsHtml(): string {
    return '<div class="msg-actions"><button class="msg-pin-reminder" type="button" title="Pin as reminder" aria-label="Pin as reminder"></button><button class="msg-copy" type="button" title="Copy" aria-label="Copy message"></button></div>';
}

export function initMessageActions(options: MessageActionsOptions = {}): void {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    bindProcessBlockInteractions(chatMessages);
    bindToolItemInteractions(chatMessages);
    chatMessages.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (toggleToolGroup(target)) return;

        const copyBtn = target.closest('.msg-copy') as HTMLElement | null;
        if (copyBtn) {
            copyMessage(copyBtn).catch((error) => {
                options.onStatus?.(`Copy failed: ${(error as Error).message}`);
            });
            return;
        }

        const pinBtn = target.closest('.msg-pin-reminder') as HTMLElement | null;
        if (pinBtn) void pinMessage(pinBtn, options);
    });
}

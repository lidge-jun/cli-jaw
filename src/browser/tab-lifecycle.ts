import { closeTab, listTabs, type BrowserTabInfo } from './connection.js';
import { listSessions } from './web-ai/session.js';

const DEFAULT_MAX_TABS = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

const pinnedTabs = new Set<string>();

export interface TabCleanupCandidate extends BrowserTabInfo {
    cleanupReason: 'idle-timeout' | 'max-tabs' | 'untracked';
}

export interface TabCleanupOptions {
    now?: number;
    idleTimeoutMs?: number;
    maxTabs?: number;
    includeUntracked?: boolean;
}

export interface TabCleanupSummary {
    closed: number;
    idleClosed: number;
    limitClosed: number;
    untrackedClosed: number;
}

export function parseTabDuration(value: string | number | null | undefined): number {
    const raw = String(value || '').trim();
    const match = /^(\d+)\s*(ms|s|m|h)?$/i.exec(raw);
    if (!match) return DEFAULT_IDLE_TIMEOUT_MS;
    const n = Number(match[1]);
    const unit = (match[2] || 'm').toLowerCase();
    if (unit === 'ms') return n;
    if (unit === 's') return n * 1000;
    if (unit === 'h') return n * 3_600_000;
    return n * 60_000;
}

export function pinTab(targetId: string): void {
    pinnedTabs.add(targetId);
}

export function unpinTab(targetId: string): void {
    pinnedTabs.delete(targetId);
}

export function isPinned(targetId: string): boolean {
    return pinnedTabs.has(targetId);
}

export function selectTabsForCleanup({
    tabs,
    activeSessionTargetIds = new Set<string>(),
    pinnedTargetIds = new Set<string>(),
    now = Date.now(),
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    maxTabs = DEFAULT_MAX_TABS,
    includeUntracked = false,
}: {
    tabs: BrowserTabInfo[];
    activeSessionTargetIds?: Set<string>;
    pinnedTargetIds?: Set<string>;
    now?: number;
    idleTimeoutMs?: number;
    maxTabs?: number;
    includeUntracked?: boolean;
}): TabCleanupCandidate[] {
    const selected = new Map<string, TabCleanupCandidate>();
    const closeable = tabs.filter(tab =>
        tab.targetId &&
        !pinnedTargetIds.has(tab.targetId) &&
        !activeSessionTargetIds.has(tab.targetId)
    );

    for (const tab of closeable) {
        const lastActiveAt = Number(tab.lastActiveAt);
        const tracked = Number.isFinite(lastActiveAt) && lastActiveAt > 0;
        if ((tracked && now - lastActiveAt > idleTimeoutMs) || (!tracked && includeUntracked)) {
            selected.set(tab.targetId, {
                ...tab,
                cleanupReason: tracked ? 'idle-timeout' : 'untracked',
            });
        }
    }

    const remaining = tabs.filter(tab => tab.targetId && !selected.has(tab.targetId));
    const remainingCloseable = remaining.filter(tab =>
        !pinnedTargetIds.has(tab.targetId) &&
        !activeSessionTargetIds.has(tab.targetId)
    );

    if (remaining.length > maxTabs) {
        const limitCloseCount = remaining.length - maxTabs;
        const oldest = remainingCloseable
            .slice()
            .sort((a, b) => (Number(a.lastActiveAt) || 0) - (Number(b.lastActiveAt) || 0))
            .slice(0, limitCloseCount);
        for (const tab of oldest) {
            selected.set(tab.targetId, { ...tab, cleanupReason: 'max-tabs' });
        }
    }

    return Array.from(selected.values());
}

export async function cleanupIdleTabs(port: number, opts: TabCleanupOptions = {}): Promise<TabCleanupSummary> {
    const tabs = await listTabs(port);
    const activeSessionTargetIds = new Set<string>();
    for (const session of [...listSessions({ status: 'sent' }), ...listSessions({ status: 'streaming' })]) {
        if (session.targetId) activeSessionTargetIds.add(session.targetId);
    }

    const candidates = selectTabsForCleanup({
        tabs,
        activeSessionTargetIds,
        pinnedTargetIds: pinnedTabs,
        now: opts.now || Date.now(),
        idleTimeoutMs: opts.idleTimeoutMs || parseTabDuration(process.env.JAW_BROWSER_TAB_IDLE || '30m'),
        maxTabs: opts.maxTabs || Number(process.env.JAW_BROWSER_MAX_TABS || DEFAULT_MAX_TABS),
        includeUntracked: opts.includeUntracked === true,
    });

    const summary: TabCleanupSummary = { closed: 0, idleClosed: 0, limitClosed: 0, untrackedClosed: 0 };
    for (const tab of candidates) {
        try {
            await closeTab(port, tab.targetId);
            summary.closed += 1;
            if (tab.cleanupReason === 'idle-timeout') summary.idleClosed += 1;
            else if (tab.cleanupReason === 'max-tabs') summary.limitClosed += 1;
            else if (tab.cleanupReason === 'untracked') summary.untrackedClosed += 1;
        } catch {
            // Tab may already be closed by the user or Chrome.
        }
    }
    return summary;
}

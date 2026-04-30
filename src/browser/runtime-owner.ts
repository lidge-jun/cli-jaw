export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_REAPER_INTERVAL_MS = 30 * 1000;

const MIN_TIMER_MS = 100;

export type BrowserRuntimeOwnership = 'jaw-owned' | 'external' | 'none';
export type BrowserCloseReason = 'manual' | 'idle';
export type BrowserCloseAction = 'close-owned' | 'disconnect-only' | 'skip';

export interface BrowserRuntimeOwner {
    ownership: BrowserRuntimeOwnership;
    pid: number | null;
    port: number | null;
    userDataDir: string | null;
    startedAt: string | null;
    lastUsedAt: string | null;
    headless: boolean | null;
    idleTimeoutMs: number;
    autoCloseEnabled: boolean;
    verified: boolean;
}

export interface BrowserRuntimeStatus extends BrowserRuntimeOwner {
    activeCommandCount: number;
}

function nowIso(): string {
    return new Date().toISOString();
}

export function parseBrowserRuntimeTimeout(
    value: string | undefined,
    fallback: number,
): number {
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < MIN_TIMER_MS) return fallback;
    return Math.floor(parsed);
}

export function createEmptyBrowserRuntime(
    activeCommandCount = 0,
): BrowserRuntimeStatus {
    return {
        ownership: 'none',
        pid: null,
        port: null,
        userDataDir: null,
        startedAt: null,
        lastUsedAt: null,
        headless: null,
        idleTimeoutMs: browserIdleTimeoutMs(),
        autoCloseEnabled: false,
        verified: false,
        activeCommandCount,
    };
}

export function createJawOwnedBrowserRuntime(options: {
    port: number;
    pid: number | null;
    userDataDir: string;
    headless: boolean;
}): BrowserRuntimeOwner {
    const now = nowIso();
    return {
        ownership: 'jaw-owned',
        pid: options.pid,
        port: options.port,
        userDataDir: options.userDataDir,
        startedAt: now,
        lastUsedAt: now,
        headless: options.headless,
        idleTimeoutMs: browserIdleTimeoutMs(),
        autoCloseEnabled: true,
        verified: true,
    };
}

export function createExternalBrowserRuntime(port: number): BrowserRuntimeOwner {
    return {
        ownership: 'external',
        pid: null,
        port,
        userDataDir: null,
        startedAt: null,
        lastUsedAt: null,
        headless: null,
        idleTimeoutMs: browserIdleTimeoutMs(),
        autoCloseEnabled: false,
        verified: false,
    };
}

export function browserIdleTimeoutMs(): number {
    return parseBrowserRuntimeTimeout(
        process.env.JAW_BROWSER_IDLE_TIMEOUT_MS,
        DEFAULT_IDLE_TIMEOUT_MS,
    );
}

export function browserReaperIntervalMs(): number {
    return parseBrowserRuntimeTimeout(
        process.env.JAW_BROWSER_REAPER_INTERVAL_MS,
        DEFAULT_REAPER_INTERVAL_MS,
    );
}

export function shouldCloseIdleRuntime(
    owner: BrowserRuntimeOwner | null,
    nowMs: number,
    activeCommandCount: number,
): boolean {
    if (!owner) return false;
    if (owner.ownership !== 'jaw-owned') return false;
    if (!owner.autoCloseEnabled) return false;
    if (activeCommandCount > 0) return false;
    if (!owner.lastUsedAt) return false;
    const lastUsedMs = Date.parse(owner.lastUsedAt);
    if (!Number.isFinite(lastUsedMs)) return false;
    return nowMs - lastUsedMs >= owner.idleTimeoutMs;
}

export function decideBrowserCloseAction(
    owner: BrowserRuntimeOwner | null,
    reason: BrowserCloseReason,
    proofOk: boolean,
): BrowserCloseAction {
    if (!owner) return 'skip';
    if (owner.ownership === 'external') {
        return reason === 'manual' ? 'disconnect-only' : 'skip';
    }
    if (owner.ownership !== 'jaw-owned') return 'skip';
    return proofOk ? 'close-owned' : 'skip';
}

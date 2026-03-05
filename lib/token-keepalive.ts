// ─── Token Keep-Alive: auto-refresh before expiry ─────
import { execFileSync } from 'child_process';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1시간
let _timer: ReturnType<typeof setInterval> | null = null;

export function startTokenKeepAlive() {
    if (_timer) return;
    setTimeout(() => {
        refreshClaude();
        _timer = setInterval(refreshClaude, CHECK_INTERVAL_MS);
        _timer.unref?.();
    }, 30_000);
    console.log('[token-keepalive] started (interval: 1h)');
}

export function stopTokenKeepAlive() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

function refreshClaude() {
    try {
        const ver = execFileSync('claude', ['--version'], {
            timeout: 10_000,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        console.log(`[token-keepalive] Claude token refreshed (${ver})`);
    } catch (e: unknown) {
        console.warn('[token-keepalive] Claude refresh failed:', (e as Error).message?.split('\n')[0]);
    }
}

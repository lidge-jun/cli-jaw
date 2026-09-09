import { slackToolDenied } from './tool-access.js';
const TIER_TWO = new Set(['reactions.remove', 'reactions.get', 'pins.add', 'pins.remove', 'pins.list', 'bookmarks.add', 'bookmarks.edit', 'bookmarks.remove', 'bookmarks.list', 'slackLists.create', 'slackLists.items.list', 'assistant.search.info']);
export class SlackActionRateLimiter {
    private readonly next = new Map<string, number>();
    constructor(private readonly now = () => Date.now(), private readonly pause: (ms: number, signal?: AbortSignal) => Promise<void> = abortablePause) {}
    async admit(workspace: string, method: string, signal?: AbortSignal): Promise<void> {
        if (signal?.aborted) throw slackToolDenied('slack_action_cancelled', 499);
        const key = `${workspace}:${method}`; const now = this.now();
        const start = Math.max(now, this.next.get(key) ?? now);
        if (start - now > 10000) throw Object.assign(slackToolDenied('slack_action_rate_limited', 429), { retryAfterMs: start - now });
        if (!this.next.has(key) && this.next.size >= 1024) {
            for (const [old, at] of this.next) if (at <= now) this.next.delete(old);
            if (this.next.size >= 1024) throw slackToolDenied('slack_action_rate_capacity', 429);
        }
        this.next.set(key, start + (TIER_TWO.has(method) ? 3000 : 1200));
        if (start > now) await this.pause(start - now, signal);
        if (signal?.aborted) throw slackToolDenied('slack_action_cancelled', 499);
    }
}
function abortablePause(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(finish, ms);
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(slackToolDenied('slack_action_cancelled', 499)); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
    });
}

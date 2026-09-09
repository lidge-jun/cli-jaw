// ─── Verified Slack workspace ────────────────────────
// The mention-watch ledger is keyed by (workspace, user), so a wrong workspace id
// hands one person cursor to another. That makes the SOURCE of the id part of the
// correctness argument.
//
// `settings.slack.teamId` is not that source. It is written only when empty and
// never re-checked against the token, so a token pointing at workspace B while the
// setting still says A yields rows filed under A.
//
// `initSlack` is not the entry point either: with no app token it returns before
// calling `auth.test` at all, and mention watch needs only a bot token. Depending
// on it would fail-close every outbound-only install that works today.
//
// So this asks Slack directly, once per token, and caches the answer against the
// token that produced it. A token change invalidates the cache by construction.

import { slackApi } from './api.js';
import type { SlackFetch } from './api.js';

type Verified = { token: string; teamId: string; userId: string | null; scopes: string[] | null; observedAt: number };

let cached: Verified | null = null;

/** Test seam. Never called in production paths. */
export function resetVerifiedSlackWorkspace(): void {
    cached = null;
}

/**
 * The team id Slack itself reports for this token, or null when it cannot be
 * established.
 *
 * Null is a refusal, not a default: a caller that keys durable state on this must
 * skip the work rather than guess. One failed lookup skips one tick, which is
 * recoverable; a guessed key writes into someone else ledger, which is not.
 */
export async function verifiedSlackWorkspace(
    token: string,
    opts: { fetchImpl?: SlackFetch | undefined; sensitiveResponse?: boolean; signal?: AbortSignal; refresh?: boolean } = {},
): Promise<{ teamId: string; userId: string | null } | null> {
    const trimmed = token.trim();
    if (!trimmed) return null;
    if (cached && cached.token === trimmed && !opts.refresh) {
        return { teamId: cached.teamId, userId: cached.userId };
    }
    const auth = await slackApi<{ team_id?: string; user_id?: string }>(
        trimmed,
        'auth.test',
        {},
        { ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}), ...(opts.sensitiveResponse ? { sensitiveResponse: true } : {}), ...(opts.signal ? { signal: opts.signal } : {}) },
    );
    const teamId = typeof auth.data?.team_id === 'string' ? auth.data.team_id.trim() : '';
    if (!auth.ok || !/^T[A-Za-z0-9_]{0,63}$/.test(teamId)) return null;
    const rawUser = typeof auth.data?.user_id === 'string' ? auth.data.user_id.trim() : '';
    const userId = /^[UW][A-Za-z0-9_]{0,63}$/.test(rawUser) ? rawUser : null;
    const rawScopes = auth.grantedScopes;
    const split = rawScopes === undefined ? null : rawScopes.split(',').map(value => value.trim()).filter(Boolean);
    const scopes = split && split.length <= 256 && split.every(value => /^[a-z][a-z0-9_.]*(?::[a-z0-9_.]+)*$/.test(value) && value.length <= 80) ? [...new Set(split)] : null;
    cached = { token: trimmed, teamId, userId, scopes, observedAt: Date.now() };
    return { teamId, userId };
}

export async function readSlackAuthSnapshot(token: string, opts: { fetchImpl?: SlackFetch; signal?: AbortSignal } = {}): Promise<{ teamId: string; userId: string | null; scopes: string[] | null; observedAt: number } | null> {
    const refresh = !cached || cached.token !== token.trim() || Date.now() - cached.observedAt > 30000;
    const identity = await verifiedSlackWorkspace(token, { ...opts, sensitiveResponse: true, refresh });
    if (!identity || !cached || cached.token !== token.trim()) return null;
    return { ...identity, scopes: cached.scopes ? [...cached.scopes] : null, observedAt: cached.observedAt };
}

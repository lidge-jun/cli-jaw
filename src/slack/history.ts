import { isRtsOutput, excludedRtsMessage, filterRtsOutputs } from './rts-output-store.js';
// ─── Slack Dynamic Lookup (history / replies) ────────
// Read-side of the Slack transport: conversations.history for a channel
// window, conversations.replies for one thread. The agent uses this through
// GET /api/slack/history (and `jaw slack history`) to pull conversation
// context it was not mentioned into.
// Internal customer-built apps keep Tier 3, so limit=50 defaults are safe.

import { slackApi, describeSlackError, isRetryableSlackError, type SlackFetch } from './api.js';
import { extractTextFromBlocksDetailed, type SlackFileEvent } from './events.js';
import { redactOutboundPayload } from '../messaging/redact.js';
import { redactChannelSecrets } from '../messaging/redact.js';

export type SlackHistoryMessage = {
    ts: string;
    threadTs?: string;
    user?: string;
    botId?: string;
    text: string;
    blocks?: unknown[];
    attachments?: unknown[];
    reactions?: Array<{ name: string; count: number; users?: string[] }>;
    edited?: { ts: string; user?: string };
    permalink?: string;
    contentTruncated?: boolean;
    contentExcluded?: boolean;
    textFromBlocks?: boolean;
    replyCount?: number;
    subtype?: string;
    /** app_mention 첨부 복구가 소비한다 (attachment-recovery.ts). */
    files?: SlackFileEvent[];
};

export type SlackHistoryResult =
    | { ok: true; messages: SlackHistoryMessage[]; hasMore: boolean; nextCursor?: string }
    /** `error` is operator prose, for logs and UI. `code` is Slack's raw error
     *  string, for callers that must BRANCH on the reason — a rate limit means
     *  "stop asking", while `not_in_channel` means "skip this one and continue".
     *  Reading that decision out of the prose would break the moment the wording
     *  changes. Absent when the failure had no Slack error code. */
    | { ok: false; error: string; code?: string };

export const SLACK_HISTORY_DEFAULT_LIMIT = 50;
export const SLACK_HISTORY_MAX_LIMIT = 200;

type RawMessage = {
    ts?: string; thread_ts?: string; user?: string; bot_id?: string;
    text?: string; reply_count?: number; subtype?: string;
    files?: SlackFileEvent[];
    blocks?: unknown[]; attachments?: unknown[];
    reactions?: SlackHistoryMessage['reactions']; edited?: SlackHistoryMessage['edited']; permalink?: string;
};
type RawHistoryData = { messages?: RawMessage[]; has_more?: boolean; response_metadata?: { next_cursor?: string } };

function clampLimit(limit: number | undefined): number {
    const n = Number(limit) || SLACK_HISTORY_DEFAULT_LIMIT;
    return Math.min(Math.max(Math.floor(n), 1), SLACK_HISTORY_MAX_LIMIT);
}

/** Acyclic, bounded projection before rich data reaches an agent or cache. */
function boundedRichValue(input: unknown): { value: unknown; truncated: boolean } {
    let remaining = 64000;
    let nodes = 0;
    let truncated = false;
    const ancestors = new Set<object>();
    const cost = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
    const visit = (value: unknown, depth: number): unknown => {
        nodes += 1;
        if (nodes > 10000 || depth > 12 || remaining < 2) { truncated = true; return undefined; }
        if (typeof value === 'string') {
            let result = value;
            if (cost(result) > remaining) {
                let low = 0, high = Math.min(value.length, remaining);
                while (low < high) {
                    const middle = Math.ceil((low + high) / 2);
                    if (cost(value.slice(0, middle)) <= remaining) low = middle;
                    else high = middle - 1;
                }
                result = value.slice(0, low);
                truncated = true;
            }
            remaining -= cost(result);
            return result;
        }
        if (value === null || typeof value === 'number' || typeof value === 'boolean') {
            const bytes = cost(value);
            if (bytes > remaining) { truncated = true; return undefined; }
            remaining -= bytes;
            return value;
        }
        if (!value || typeof value !== 'object') return undefined;
        if (ancestors.has(value)) { truncated = true; return undefined; }
        ancestors.add(value);
        remaining -= 2;
        const out: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {};
        for (const key of Object.keys(value)) {
            nodes += 1;
            if (nodes >= 10000 || remaining < 4) { truncated = true; break; }
            if (['__proto__', 'constructor', 'prototype'].includes(key)) { truncated = true; continue; }
            const overhead = Array.isArray(out) ? 1 : cost(key) + 2;
            if (overhead + 2 > remaining) { truncated = true; continue; }
            remaining -= overhead;
            const item = visit((value as Record<string, unknown>)[key], depth + 1);
            if (item !== undefined) {
                if (Array.isArray(out)) out.push(item);
                else out[key] = item;
            }
        }
        ancestors.delete(value);
        return out;
    };
    const value = visit(input, 0);
    return { value, truncated };
}

export function slackDataForAgent(value: unknown): { value: unknown; truncated: boolean } {
    const projected = boundedRichValue(value);
    const redacted = boundedRichValue(redactOutboundPayload(projected.value));
    return { value: redacted.value, truncated: projected.truncated || redacted.truncated };
}

/** Internal downloads retain their original URLs; only agent-facing copies are redacted. */
export function slackHistoryForAgent(messages: SlackHistoryMessage[]): SlackHistoryMessage[] {
    return messages.map(message => {
        const { ts, text, ...optional } = message;
        const projected = boundedRichValue({ ts, text, ...optional });
        const redacted = boundedRichValue(redactOutboundPayload(projected.value));
        const safe = redacted.value as Partial<SlackHistoryMessage>;
        return { ...safe, ts: message.ts, text: safe.text ?? '',
            ...(projected.truncated || redacted.truncated || message.contentTruncated ? { contentTruncated: true } : {}) };
    });
}

function normalize(raw: RawMessage[]): SlackHistoryMessage[] {
    const out: SlackHistoryMessage[] = [];
    for (const m of raw) {
        if (!m || typeof m.ts !== 'string' || m.ts.length > 32 || !/^\d+(?:\.\d+)?$/.test(m.ts) || !Number.isFinite(Number(m.ts)) || Number(m.ts) > 8640000000000) continue;
        if (isRtsOutput(m.blocks)) { out.push(excludedRtsMessage(m.ts, m.thread_ts)); continue; }
        const rich = boundedRichValue({
            ...(Array.isArray(m.blocks) ? { blocks: m.blocks } : {}),
            ...(Array.isArray(m.attachments) ? { attachments: m.attachments } : {}),
            ...(Array.isArray(m.reactions) ? { reactions: m.reactions } : {}),
            ...(m.edited && typeof m.edited.ts === 'string' ? { edited: { ts: m.edited.ts.slice(0, 32),
                ...(typeof m.edited.user === 'string' ? { user: m.edited.user.slice(0, 64) } : {}) } } : {}),
            ...(typeof m.permalink === 'string' ? { permalink: m.permalink } : {}),
        });
        const fields = rich.value as Partial<SlackHistoryMessage>;
        const extracted = extractTextFromBlocksDetailed([...(fields.blocks ?? []), ...(fields.attachments ?? [])], 40000);
        out.push({
            ...fields,
            ...(!(typeof m.text === 'string' && m.text.length) && extracted.text ? { textFromBlocks: true } : {}),
            ...(rich.truncated || extracted.truncated ? { contentTruncated: true } : {}),
            ts: m.ts,
            ...(m.thread_ts ? { threadTs: m.thread_ts } : {}),
            ...(m.user ? { user: m.user } : {}),
            ...(m.bot_id ? { botId: m.bot_id } : {}),
            text: typeof m.text === 'string' && m.text.length ? m.text : extracted.text,
            ...(typeof m.reply_count === 'number' ? { replyCount: m.reply_count } : {}),
            ...(m.subtype ? { subtype: m.subtype } : {}),
            ...(Array.isArray(m.files) && m.files.length ? { files: m.files } : {}),
        });
    }
    return out;
}

export type SlackHistoryOpts = {
    limit?: number;
    cursor?: string;
    oldest?: string;
    latest?: string;
    inclusive?: boolean;
    fetchImpl?: SlackFetch;
    /** Cancels the request, the retry wait, and any further attempt. */
    signal?: AbortSignal;
    /**
     * Skip the bounded retry when Slack answers `ratelimited`.
     *
     * Default false keeps today's behavior for `/api/slack/history` and
     * attachment recovery. Enrichment callers set it: they own a suppression
     * window of their own, and retrying a 429 fires a second request before that
     * window can be applied.
     */
    noRetryOnRateLimit?: boolean;
    /** Do not retry any Slack error. Scheduled destination verification owns a
     * future tick and must not spend a second shared API call in this one. */
    noRetry?: boolean;
    sensitiveResponse?: boolean;
};

/**
 * Abortable sleep. A cancelled ingress must not hold the loop open, which is
 * why the timer is unref'd by default.
 *
 * `keepAlive` exists for callers that are AWAITING the pause as part of their
 * result: an unref'd timer lets the process exit mid-await, and the pending
 * promise then resolves never. Under CI load that surfaced as
 * "Promise resolution is still pending but the event loop has already
 * resolved" on the retry-backoff path.
 */
function sleepUnlessAborted(ms: number, signal?: AbortSignal, keepAlive = false): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    return new Promise<void>(resolve => {
        const timer = setTimeout(finish, ms);
        if (!keepAlive) timer.unref?.();
        function finish(): void {
            clearTimeout(timer);
            signal?.removeEventListener('abort', finish);
            resolve();
        }
        signal?.addEventListener('abort', finish, { once: true });
    });
}

async function callWithRetry(
    token: string,
    method: 'conversations.history' | 'conversations.replies',
    body: Record<string, unknown>,
    opts: SlackHistoryOpts = {},
): Promise<SlackHistoryResult> {
    // form-encoded on purpose: conversations.replies REJECTS a JSON body with
    // invalid_arguments ("missing required field: channel/ts") — verified live
    // 2026-08-06 against T0BMJ7RSPHQ. conversations.history accepts both, so
    // both ride the form path for one consistent contract.
    const callOpts = {
        form: true as const,
        ...(opts.sensitiveResponse ? { sensitiveResponse: true } : {}),
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
    };
    let result = await slackApi<RawHistoryData>(token, method, body, callOpts);
    // A 429 is retried by default (existing callers depend on it), but an
    // enrichment caller opts out: it applies its own suppression window, and a
    // retry would fire a second request before that window exists.
    const retryable = opts.noRetry !== true && isRetryableSlackError(result.error)
        && !(opts.noRetryOnRateLimit && result.error === 'ratelimited');
    if (!result.ok && retryable && !opts.signal?.aborted) {
        // One bounded retry after a short pause (Hermes uses 1s/2s; a single
        // 1s attempt is enough for an interactive lookup — the caller can
        // simply retry the whole request otherwise).
        // keepAlive: the caller is awaiting this pause to produce its result,
        // so the process must not be allowed to exit mid-backoff.
        await sleepUnlessAborted(1000, opts.signal, true);
        // Re-check: the wait is where a cancel usually lands.
        if (!opts.signal?.aborted) {
            result = await slackApi<RawHistoryData>(token, method, body, callOpts);
        }
    }
    if (!result.ok) {
        // describeSlackError output is operator prose (never echoes tokens);
        // redact defensively anyway since it can embed upstream messages.
        return {
            ok: false,
            error: redactChannelSecrets(describeSlackError(result.error, result.data)),
            ...(result.error ? { code: result.error } : {}),
        };
    }
    const nextCursor = result.data?.response_metadata?.next_cursor?.trim();
    return {
        ok: true,
        messages: await filterRtsOutputs(token, String(body['channel'] ?? ''), normalize(result.data?.messages ?? []), opts.signal, opts.fetchImpl),
        hasMore: result.data?.has_more === true || Boolean(nextCursor),
        ...(nextCursor ? { nextCursor } : {}),
    };
}

/**
 * Channel window: conversations.history (newest first, as Slack returns).
 *
 * `oldest`/`latest` are EXCLUSIVE bounds: a message whose ts equals either
 * bound is omitted unless `inclusive` is set. Fetching one known message
 * therefore needs `{ oldest: ts, inclusive: true, limit: 1 }` — passing
 * oldest===latest without `inclusive` returns an empty list, which silently
 * turns any ts-addressed lookup into a no-op.
 * https://docs.slack.dev/reference/methods/conversations.history/
 */
export function fetchSlackHistory(
    token: string,
    channel: string,
    opts: SlackHistoryOpts & { oldest?: string; latest?: string; inclusive?: boolean } = {},
): Promise<SlackHistoryResult> {
    return callWithRetry(token, 'conversations.history', {
        channel,
        limit: clampLimit(opts.limit),
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
        ...(opts.oldest ? { oldest: opts.oldest } : {}),
        ...(opts.latest ? { latest: opts.latest } : {}),
        // Slack ignores `inclusive` when neither bound is present; send it only
        // when it can actually take effect.
        ...(opts.inclusive && (opts.oldest || opts.latest) ? { inclusive: true } : {}),
    }, opts);
}

/** One thread: conversations.replies (parent message included, oldest first). */
export function fetchSlackReplies(
    token: string,
    channel: string,
    threadTs: string,
    opts: SlackHistoryOpts = {},
): Promise<SlackHistoryResult> {
    return callWithRetry(token, 'conversations.replies', {
        channel,
        ts: threadTs,
        limit: clampLimit(opts.limit),
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
        ...(opts.oldest ? { oldest: opts.oldest } : {}),
        ...(opts.latest ? { latest: opts.latest } : {}),
        ...(opts.inclusive && (opts.oldest || opts.latest) ? { inclusive: true } : {}),
    }, opts);
}

// Bounds the rendered history handed to the preamble. It has to be at least as
// large as PREAMBLE_TOTAL_CAP or it becomes the real limit and raising the
// preamble's own cap changes nothing — this cut runs FIRST and in the same
// direction (#518).
const FORMAT_CHAR_CAP = 12000;

/**
 * Chronological plain-text rendering for the agent prompt. Mentions like
 * <@U123> are preserved (they carry speaker identity); everything passes
 * the channel-secret redactor so a token pasted INTO a Slack message can
 * never round-trip back into an agent prompt or terminal.
 */
export function formatHistoryForAgentDetailed(
    messages: SlackHistoryMessage[],
    selfUserId?: string | null,
    names?: ReadonlyMap<string, string>,
): { text: string; truncated: boolean } {
    const chronological = [...messages].sort((a, b) => Number(a.ts) - Number(b.ts));
    const lines: string[] = [];
    for (const m of chronological) {
        const when = new Date(Number(m.ts) * 1000).toISOString().slice(0, 16).replace('T', ' ');
        // A resolved name never replaces the id — the agent still needs the id for
        // any follow-up API call, so both are shown.
        const resolvedName = m.user ? names?.get(m.user) : m.botId ? names?.get(m.botId) : undefined;
        const who = m.user
            ? (m.user === selfUserId
                ? 'bot(self)'
                : resolvedName ? `${resolvedName} (${m.user})` : `<@${m.user}>`)
            : (m.botId
                ? (resolvedName ? `${resolvedName} (bot:${m.botId})` : `bot:${m.botId}`)
                : 'unknown');
        const suffix = m.replyCount ? ` [${m.replyCount} replies]` : '';
        lines.push(`[${when}] [UTC ts=${m.ts}] ${who}: ${m.text}${suffix}${m.permalink ? ` ${m.permalink}` : ''}`);
    }
    // Keep the NEWEST lines when the history overflows. Slicing from the front
    // dropped the most recent messages, which are the ones a follow-up question
    // refers to; whole lines only, since half a timestamp is worse than a
    // missing message (#518).
    const full = redactChannelSecrets(lines.join('\n'));
    return { text: keepNewestLines(full, FORMAT_CHAR_CAP), truncated: full.length > FORMAT_CHAR_CAP };
}

export function formatHistoryForAgent(
    messages: SlackHistoryMessage[], selfUserId?: string | null, names?: ReadonlyMap<string, string>,
): string {
    return formatHistoryForAgentDetailed(messages, selfUserId, names).text;
}

/** Trim to a character bound from the FRONT, dropping whole lines. */
function keepNewestLines(text: string, max: number): string {
    if (text.length <= max) return text;
    const lines = text.split('\n');
    const kept: string[] = [];
    let size = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i] as string;
        const cost = size === 0 ? line.length : line.length + 1;
        if (size + cost > max) {
            if (!kept.length) kept.push(line.slice(0, Math.max(0, max - 24)) + ' [content truncated]');
            break;
        }
        kept.push(line);
        size += cost;
    }
    return kept.reverse().join('\n');
}

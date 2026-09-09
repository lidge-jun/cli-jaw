// ─── Slack Send-Only Client ──────────────────────────
// Outbound path that works with just the bot token, independent of whether the
// Socket Mode inbound connection is up. Mirrors src/discord/send-only-client.ts.

import { settings } from '../core/config.js';
import type { RemoteTarget } from '../messaging/types.js';
import { slackApi, describeSlackError, slackFailure, type SlackFetch } from './api.js';
import { abortableDelay } from '../messaging/outbound-lifecycle.js';
import { buildSlackTextPayloads } from './format.js';
import { buildSlackBlockPayloads, expectedTableShapes, type TableShape, type SlackTextPayload } from './blocks.js';
import { boundSlackContent, expectedTableContent, type CanonicalTable, type TableContentStatus } from './table-content.js';
import { verifySlackTables } from './table-verification.js';
import { expectedRichFeatures } from './render-features.js';
import { MAX_INLINE_RATE_LIMIT_MS, classifySendFailure, retryAfterMs } from '../messaging/retry.js';
import { log } from '../core/logger.js';

export type SlackSendClientResult =
    | { token: string; reason?: never; status?: never }
    | { token: null; reason: string; status: 400 | 503 };

export function invalidateSlackSendClient(): void {
    // no-op: the token is read fresh from settings on every call.
    // Present so runtime-settings.ts can invalidate symmetrically with Discord.
}

export function getSlackSendClient(): SlackSendClientResult {
    const sc = settings["slack"];
    if (!sc?.enabled) return { token: null, reason: 'slack_disabled', status: 503 };
    const token = typeof sc.botToken === 'string' ? sc.botToken.trim() : '';
    if (!token) return { token: null, reason: 'slack_bot_token_missing', status: 503 };
    return { token };
}

/** Resolve a DM conversation id for a user id, opening the DM if needed. */
export async function resolveSlackDmChannel(
    token: string,
    userId: string,
    fetchImpl?: SlackFetch,
): Promise<{ ok: boolean; channelId?: string; error?: string }> {
    if (!userId.toUpperCase().startsWith('U')) return { ok: true, channelId: userId };
    const result = await slackApi<{ channel?: { id?: string } }>(
        token, 'conversations.open', { users: userId }, fetchImpl ? { fetchImpl } : {},
    );
    const channelId = result.data?.channel?.id;
    if (!result.ok || !channelId) {
        // Pass the payload so a missing im:write names itself.
        return { ok: false, error: describeSlackError(result.error || 'conversations_open_failed', result.data) };
    }
    return { ok: true, channelId };
}

/** One record per Slack message that actually landed.
 *
 *  This is the ONLY place every Slack post is visible. `sendChannelOutput` sees
 *  a subset — the dispatch settle path, the queued reply, the recovered-queue
 *  forwarder, and the generic forwarder all call this transport directly — so an
 *  audit that reads only `outbound.send` misses exactly the paths most likely to
 *  double.
 *
 *  The two records are NOT interchangeable and must not be summed: a send routed
 *  through the choke point emits `outbound.send` AND lands here. `slack.post` is
 *  the post-level count, `outbound.send` the request-level one.
 *
 *  Emitted per chunk rather than once at the end, because a long answer is
 *  several posts and a failure partway leaves the earlier ones on screen.
 *  Recording once on full success would report nothing for a send the user can
 *  already read — the direction that hides a duplicate. `index`/`of` keep the
 *  pieces recognizable as one answer.
 *
 *  No body: destination and shape, never the words. */
function recordSlackPost(target: RemoteTarget, index: number, of: number): void {
    log.event('slack.post', {
        target: target.targetId,
        ...(target.threadId ? { threaded: true } : {}),
        index,
        of,
    });
}

export async function sendSlackText(
    token: string,
    target: RemoteTarget,
    text: string,
    options: { fetchImpl?: SlackFetch; blocks?: unknown; signal?: AbortSignal; requireBodyDelivery?: boolean; sensitiveResponse?: boolean } = {},
): Promise<{ ok: boolean; error?: string; status?: number; ts?: string; sent?: boolean;
    retryable?: boolean; delivery?: { verification: 'verified' | 'failed';
        expectedTables: number; verifiedTables: number; channelId: string; messageTs: string[];
        expectedFeatures?: string[]; verifiedFeatures?: string[]; tableContent: TableContentStatus; richContent: 'not_checked'; sourceAccuracy: 'not_checked'; comparisonVersion: 1 } }> {
    let chunks: SlackTextPayload[];
    let shapes: TableShape[][];
    let content: CanonicalTable[][];
    try {
        if (options.blocks != null) boundSlackContent(options.blocks);
        chunks = options.blocks != null
            ? buildSlackBlockPayloads(text, options.blocks)
            : buildSlackTextPayloads(text);
        content = chunks.map(chunk => expectedTableContent(chunk.blocks));
        shapes = chunks.map(chunk => expectedTableShapes(chunk.blocks));
    } catch (error) {
        if (error instanceof RangeError) return slackFailure(error.message, 400);
        throw error;
    }
    if (options.requireBodyDelivery && !chunks.some(chunk => chunk.text.trim().length > 0)) {
        return slackFailure('empty_message', 400);
    }
    const expectedTables = shapes.reduce((total, part) => total + part.length, 0);
    const features = chunks.map(chunk => expectedRichFeatures(chunk.blocks));
    const allFeatures = [...new Set(features.flat())].sort();
    const verifiedFeatures = new Set<string>();
    const needsVerification = expectedTables > 0 || allFeatures.length > 0;
    let verifiedTables = 0;
    let firstTs: string | undefined;
    const messageTs: string[] = [];
    const receipt = (verification: 'verified' | 'failed') => ({
        verification, expectedTables, verifiedTables,
        tableContent: (expectedTables ? (verifiedTables === expectedTables ? 'verified' : 'failed') : 'not_checked') as TableContentStatus,
        richContent: 'not_checked' as const, sourceAccuracy: 'not_checked' as const, comparisonVersion: 1 as const, channelId: target.targetId, messageTs,
        ...(allFeatures.length ? { expectedFeatures: allFeatures, verifiedFeatures: [...verifiedFeatures].sort() } : {}),
    });
    // Preserve evidence of partial delivery. Retrying a whole send after a
    // readback failure would post the same table again; callers must re-read it.
    const failure = (error: string, status = 502) => ({
        ...slackFailure(error, status),
        ...(firstTs ? { ts: firstTs, sent: true, retryable: false } : {}),
        ...(needsVerification ? { delivery: receipt('failed') } : {}),
    });
    const callOpts = {
        ...(options.sensitiveResponse !== undefined ? { sensitiveResponse: options.sensitiveResponse } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
    };
    for (const [index, chunk] of chunks.entries()) {
        if (options.signal?.aborted) return failure('slack_send_aborted', 499);
        const payload = {
            channel: target.targetId, ...chunk,
            ...(target.threadId ? { thread_ts: target.threadId } : {}),
        };
        let result = await slackApi<{ ts?: string }>(token, 'chat.postMessage', payload, callOpts);
        if (!result.ok) {
            if (result.error === 'slack_send_aborted') return failure('slack_send_aborted', 499);
            const classified = classifySendFailure(result);
            const wait = result.retryAfterMs ?? retryAfterMs(result);
            if (classified === 'rate-limit' && wait > 0 && wait <= MAX_INLINE_RATE_LIMIT_MS) {
                await abortableDelay(wait, options.signal);
                if (options.signal?.aborted) return failure('slack_send_aborted', 499);
                // Retry exactly the same redacted payload, including its blocks.
                result = await slackApi<{ ts?: string }>(token, 'chat.postMessage', payload, callOpts);
            }
            if (!result.ok) {
                if (result.error === 'slack_send_aborted') return failure('slack_send_aborted', 499);
                return { ...failure(describeSlackError(result.error, result.data), result.status),
                    ...(result.retryAfterMs !== undefined ? { retryAfterMs: result.retryAfterMs } : {}),
                    ...(result.grantedScopes !== undefined ? { grantedScopes: result.grantedScopes } : {}) };
            }
        }
        const ts = result.data?.ts;
        if (index === 0 && ts) firstTs = ts;
        if (ts) messageTs.push(ts);
        recordSlackPost(target, index, chunks.length);
        const expected = shapes[index] ?? [];
        const expectedFeatures = features[index] ?? [];
        if (expected.length || expectedFeatures.length) {
            const errorPrefix = expected.length ? 'slack_table_verification_failed' : 'slack_rich_verification_failed';
            if (!ts) return { ...failure(`${errorPrefix}:missing_message_ts`), sent: true, retryable: false };
            const checked = await verifySlackTables(token, target, ts, expected, callOpts, expectedFeatures, content[index]);
            verifiedTables += checked.verifiedTables;
            if (!checked.ok) return failure(`${errorPrefix}:${checked.reason}`);
            for (const feature of checked.verifiedFeatures ?? []) verifiedFeatures.add(feature);
        }
    }
    return { ok: true, ...(firstTs ? { ts: firstTs } : {}),
        ...(needsVerification ? { delivery: receipt('verified') } : {}) };
}

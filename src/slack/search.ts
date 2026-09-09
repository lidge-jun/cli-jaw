import { slackApi, type SlackCallOptions } from './api.js';
import type { SlackToolGrant } from './tool-context.js';
import { slackToolDenied } from './tool-access.js';
import type { SlackMessagePointer } from './message.js';

export type SlackSearchChannelType = 'public_channel' | 'private_channel' | 'im' | 'mpim';
export type SlackContextSearch = { query: string; channelTypes?: SlackSearchChannelType[]; limit?: number; cursor?: string; before?: number; after?: number; sort?: 'score' | 'timestamp'; sortDir?: 'asc' | 'desc' };
export type SlackSearchPage = { messages: Array<SlackMessagePointer & { authorId: string; content: string; permalink?: string }>; nextCursor?: string; partial?: boolean };
/** Internal only: callers must never serialize this response into the agent transcript. */
export async function searchSlackContext(token: string, grant: SlackToolGrant, input: SlackContextSearch, options: SlackCallOptions = {}): Promise<SlackSearchPage> {
    if (!grant.actionToken) throw slackToolDenied('slack_action_token_unavailable', 409);
    if (grant.signal.aborted || grant.expiresAt <= Date.now()) throw slackToolDenied('slack_turn_grant_expired', 401);
    const response = await slackApi<{ results?: { messages?: unknown }; response_metadata?: { next_cursor?: unknown } }>(token, 'assistant.search.context', {
        query: input.query, limit: input.limit ?? 20, ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(input.before !== undefined ? { before: input.before } : {}), ...(input.after !== undefined ? { after: input.after } : {}),
        sort: input.sort ?? 'score', sort_dir: input.sortDir ?? 'desc',
        action_token: grant.actionToken, context_channel_id: grant.destination.targetId,
        channel_types: input.channelTypes ?? ['public_channel'], content_types: ['messages'], include_bots: false, include_message_blocks: true, include_context_messages: true,
    }, { ...options, signal: grant.signal, sensitiveResponse: true });
    if (!response.ok) throw slackToolDenied(response.error ?? 'slack_search_failed', response.error === 'ratelimited' ? 429 : 502);
    const raw = response.data?.results?.messages;
    if (!Array.isArray(raw) || raw.length > 20) throw slackToolDenied('slack_search_response_invalid', 502);
    const messages: SlackSearchPage['messages'] = [];
    let partial = false;
    for (const item of raw) {
        if (!item || typeof item !== 'object') throw slackToolDenied('slack_search_response_invalid', 502);
        const value = item as Record<string, unknown>;
        if (value['team_id'] !== undefined && value['team_id'] !== grant.teamId) { partial = true; continue; }
        if (typeof value['channel_id'] !== 'string' || value['channel_id'].length > 64 || !/^[CGD][A-Z0-9]+$/.test(value['channel_id'])
            || typeof value['message_ts'] !== 'string' || !/^\d{1,13}\.\d{1,6}$/.test(value['message_ts'])
            || typeof value['author_user_id'] !== 'string' || !/^[UW][A-Z0-9]{1,63}$/.test(value['author_user_id']) || typeof value['content'] !== 'string'
            || value['content'].length > 100000) throw slackToolDenied('slack_search_response_invalid', 502);
        const threadTs = value['thread_ts'];
        if (threadTs !== undefined && (typeof threadTs !== 'string' || !/^\d{1,13}\.\d{1,6}$/.test(threadTs))) throw slackToolDenied('slack_search_response_invalid', 502);
        messages.push({ channel: value['channel_id'], ts: value['message_ts'], authorId: value['author_user_id'],
            content: value['content'], ...(typeof threadTs === 'string' ? { threadTs } : {}),
            ...(typeof value['permalink'] === 'string' ? { permalink: value['permalink'] } : {}) });
    }
    const cursor = response.data?.response_metadata?.next_cursor;
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 2048)) throw slackToolDenied('slack_search_response_invalid', 502);
    return { messages, ...(partial ? { partial: true } : {}), ...(typeof cursor === 'string' && cursor ? { nextCursor: cursor } : {}) };
}
export async function readSlackSearchInfo(token: string, options: SlackCallOptions = {}): Promise<{ ok: boolean; semanticSearch: boolean | null; error?: string }> {
    const result = await slackApi<{ is_ai_search_enabled?: unknown }>(token, 'assistant.search.info', {}, { ...options, sensitiveResponse: true });
    if (!result.ok) return { ok: false, semanticSearch: null, error: result.error ?? 'slack_search_info_unavailable' };
    return { ok: true, semanticSearch: typeof result.data?.is_ai_search_enabled === 'boolean' ? result.data.is_ai_search_enabled : null };
}

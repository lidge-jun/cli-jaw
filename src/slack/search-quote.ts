import type { SlackCallOptions } from './api.js';
import { searchSlackContext, type SlackSearchPage, type SlackSearchChannelType, type SlackContextSearch } from './search.js';
import { publishSlackQuote, runSlackQuoteInvocation } from './quote.js';
import { slackToolDenied, withSlackToolAccess, type SlackToolPrincipal } from './tool-access.js';
import { getRtsOutputStore } from './rts-output-store.js';

export type SlackSearchQuoteInput = Omit<SlackContextSearch, 'cursor' | 'limit'> & { invocationId: string; maxQuotes?: number; maxPages?: number };
export type SlackSearchQuoteReceipt = { ok: boolean; sent: boolean | 'unknown'; retryable: false; messageTs: string[]; partial: boolean; pagesRead: number; channelTypes?: SlackSearchChannelType[]; noResults?: boolean; error?: string };
/** RTS data never leaves this request-local server pipeline as an agent tool result. */
export async function searchAndQuoteSlack(token: string, principal: SlackToolPrincipal, input: SlackSearchQuoteInput,
    options: SlackCallOptions & { currentCredential?: () => string | null } = {}): Promise<SlackSearchQuoteReceipt> {
    if (principal.kind !== 'turn' || !principal.grant.actionToken) throw slackToolDenied('slack_action_token_unavailable', 409);
    if (!getRtsOutputStore()) throw slackToolDenied('slack_rts_privacy_unavailable', 503);
    return runSlackQuoteInvocation(token, principal, input.invocationId, input, () => withSlackToolAccess<SlackSearchQuoteReceipt>(token, principal, undefined, async () => {
        const messageTs: string[] = [];
        const cursors = new Set<string>();
        const seen = new Set<string>();
        let cursor: string | undefined;
        let pagesRead = 0;
        let partial = false;
        let found = false;
        for (let page = 0; page < (input.maxPages ?? 3); page++) {
            let result: SlackSearchPage;
            try { result = await searchSlackContext(token, principal.grant, { query: input.query, limit: 20, ...(input.channelTypes ? { channelTypes: input.channelTypes } : {}),
                ...(cursor ? { cursor } : {}), ...(input.before !== undefined ? { before: input.before } : {}),
                ...(input.after !== undefined ? { after: input.after } : {}), ...(input.sort ? { sort: input.sort } : {}),
                ...(input.sortDir ? { sortDir: input.sortDir } : {}) }, options); }
            catch { return { ok: false, sent: messageTs.length > 0, retryable: false, messageTs, partial: true, pagesRead, error: 'slack_search_unavailable_or_interrupted' }; }
            pagesRead++;
            found ||= result.messages.length > 0 || result.partial === true;
            partial ||= result.partial === true;
            for (const source of result.messages) {
                const key = `${source.channel}:${source.ts}`;
                if (seen.has(key)) continue;
                seen.add(key);
                if (messageTs.length >= (input.maxQuotes ?? 3)) { partial = true; break; }
                try {
                    const receipt = await publishSlackQuote(token, principal, { source: { channel: source.channel, ts: source.ts,
                        ...(source.threadTs ? { threadTs: source.threadTs } : {}) }, expectedAuthorId: source.authorId },
                    { ...options, sensitiveResponse: true }, `${input.invocationId}:${seen.size}`);
                    messageTs.push(...receipt.messageTs);
                    if (!receipt.ok) return { ok: false, sent: receipt.sent === 'unknown' ? 'unknown' : receipt.sent || messageTs.length > 0, retryable: false,
                        messageTs, partial: true, pagesRead, error: 'slack_search_quote_delivery_unverified' };
                } catch (error) {
                    partial = true;
                    const code = (error as { code?: string }).code;
                    if (['ratelimited', 'rate_limited', 'slack_tool_rate_limited', 'missing_scope', 'invalid_auth', 'token_revoked', 'token_expired', 'not_authed', 'account_inactive', 'not_allowed_token_type', 'team_access_not_granted', 'slack_turn_grant_expired', 'slack_credential_changed', 'slack_rts_privacy_unavailable', 'slack_rts_publication_pending'].includes(code ?? '')) return { ok: false, sent: messageTs.length > 0, retryable: false, messageTs, partial: true, pagesRead, error: 'slack_search_source_unavailable' };
                }
            }
            cursor = result.nextCursor;
            if (!cursor) break;
            if (messageTs.length >= (input.maxQuotes ?? 3) || cursors.has(cursor) || page + 1 >= (input.maxPages ?? 3)) { partial = true; break; }
            cursors.add(cursor);
        }
        return { ok: !found || messageTs.length > 0, sent: messageTs.length > 0, retryable: false, messageTs, partial, pagesRead,
            ...(!found ? { noResults: true } : messageTs.length === 0 ? { error: 'slack_search_sources_unverified' } : {}) };
    }, options.fetchImpl, receipt => ({ ...receipt, ok: false, partial: true, error: 'slack_search_quote_cancelled_after_dispatch' }), true)).then(receipt => ({ ...receipt, channelTypes: input.channelTypes ?? ['public_channel'] }));
}

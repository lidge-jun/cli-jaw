import { createHash } from 'node:crypto';
import { slackApi, type SlackCallOptions } from './api.js';
import { fetchSlackHistory, fetchSlackReplies, type SlackHistoryMessage } from './history.js';
import { redactChannelSecrets } from '../messaging/redact.js';
import { slackToolDenied } from './tool-access.js';

export type SlackMessagePointer = { channel: string; ts: string; threadTs?: string };
type MessageOptions = SlackCallOptions & { currentCredential?: () => string | null };
function currentCredential(token: string, options: MessageOptions): void {
    if (options.currentCredential && options.currentCredential() !== token) throw slackToolDenied('slack_credential_changed', 409);
}
export type SlackMessageSnapshot = { message: SlackHistoryMessage; permalink: string; revision: string };
export async function readExactSlackMessage(token: string, pointer: SlackMessagePointer, options: MessageOptions = {}): Promise<SlackHistoryMessage> {
    currentCredential(token, options);
    const bounds = { ...options, oldest: pointer.ts, latest: pointer.ts, inclusive: true, limit: 2, noRetryOnRateLimit: true };
    const result = pointer.threadTs
        ? await fetchSlackReplies(token, pointer.channel, pointer.threadTs, bounds)
        : await fetchSlackHistory(token, pointer.channel, bounds);
    currentCredential(token, options);
    if (!result.ok) throw slackToolDenied(result.code && /^[a-z_]{1,80}$/.test(result.code) ? result.code : 'slack_message_read_failed', 502);
    const matches = result.messages.filter(item => item.ts === pointer.ts);
    if (matches.length > 1) throw slackToolDenied('slack_source_ambiguous', 409);
    const message = matches[0];
    if (!message) throw slackToolDenied('slack_message_not_found_or_parent_required', 404);
    if (message.contentExcluded) throw slackToolDenied('slack_source_content_restricted');
    if (pointer.threadTs && message.threadTs && message.threadTs !== pointer.threadTs) throw slackToolDenied('slack_source_thread_mismatch');
    return message;
}
export function slackMessageRevision(message: SlackHistoryMessage): string {
    return createHash('sha256').update(JSON.stringify({ ts: message.ts, text: message.text, user: message.user,
        botId: message.botId, edited: message.edited, textFromBlocks: message.textFromBlocks })).digest('hex');
}
export async function readSlackMessageSnapshot(token: string, pointer: SlackMessagePointer, options: MessageOptions = {}): Promise<SlackMessageSnapshot> {
    const message = await readExactSlackMessage(token, pointer, options);
    const link = await slackApi<{ permalink?: string }>(token, 'chat.getPermalink', { channel: pointer.channel, message_ts: pointer.ts }, { ...options, form: true });
    currentCredential(token, options);
    const permalink = link.data?.permalink;
    if (!link.ok || typeof permalink !== 'string' || permalink.length > 2048 || redactChannelSecrets(permalink) !== permalink) throw slackToolDenied('slack_permalink_unverified', 502);
    let url: URL;
    try { url = new URL(permalink); } catch { throw slackToolDenied('slack_permalink_unverified', 502); }
    const [seconds, fraction = ''] = pointer.ts.split('.');
    const stamp = `${seconds}${fraction.padEnd(6, '0')}`;
    if (url.pathname !== `/archives/${pointer.channel}/p${stamp}` || url.protocol !== 'https:'
        || !url.hostname.endsWith('.slack.com') || url.username || url.password
        || (url.searchParams.has('cid') && url.searchParams.get('cid') !== pointer.channel)
        || (url.searchParams.has('thread_ts') && url.searchParams.get('thread_ts') !== (pointer.threadTs ?? message.threadTs ?? pointer.ts))) throw slackToolDenied('slack_permalink_source_mismatch', 502);
    return { message, permalink, revision: slackMessageRevision(message) };
}

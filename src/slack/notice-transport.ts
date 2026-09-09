// Shared by live notice cleanup and durable Slack progress restoration.
import type { NoticeTransport } from '../messaging/queue-notice.js';
import {
    deleteSlackMessage, slackApi,
    SLACK_CLEANUP_TIMEOUT_MS, type SlackFetch,
} from './api.js';

export function createSlackNoticeTransport(
    token: string,
    channelId: string,
    ts: string,
    options: { fetchImpl?: SlackFetch } = {},
): NoticeTransport {
    async function mutate(text: string | undefined, parentSignal?: AbortSignal): Promise<void> {
        const controller = new AbortController();
        const { signal } = controller;
        const abort = () => controller.abort();
        parentSignal?.addEventListener('abort', abort, { once: true });
        if (parentSignal?.aborted) abort();
        const timer = setTimeout(abort, SLACK_CLEANUP_TIMEOUT_MS);
        const callOptions = { ...options, signal, timeoutMs: SLACK_CLEANUP_TIMEOUT_MS };
        let rejectAbort: () => void = () => {};
        const cancelled = new Promise<never>((_resolve, reject) => {
            rejectAbort = () => reject(new Error('slack_progress_restore_aborted'));
            signal.addEventListener('abort', rejectAbort, { once: true });
            if (signal.aborted) rejectAbort();
        });
        async function work(): Promise<void> {
            signal.throwIfAborted();
            const stopped = await slackApi(token, 'chat.stopStream', { channel: channelId, ts }, callOptions);
            // A late successful response cannot authorize a write after disposal.
            signal.throwIfAborted();
            if (stopped.error === 'message_not_found') return;
            if (!stopped.ok && stopped.error !== 'message_not_in_streaming_state'
                && stopped.error !== 'stopped_by_user') {
                throw new Error('slack_progress_restore_incomplete');
            }
            const result = text === undefined
                ? await deleteSlackMessage(token, channelId, ts, callOptions)
                : await slackApi(token, 'chat.update', { channel: channelId, ts, text, blocks: [] }, callOptions);
            signal.throwIfAborted();
            if (!result.ok && result.error !== 'message_not_found') {
                throw new Error('slack_progress_restore_incomplete');
            }
        }
        try {
            // Also bounds injected/nonstandard fetch implementations that ignore abort.
            await Promise.race([cancelled, work()]);
        } finally {
            clearTimeout(timer);
            parentSignal?.removeEventListener('abort', abort);
            signal.removeEventListener('abort', rejectAbort);
        }
    }
    return {
        delete: signal => mutate(undefined, signal),
        edit: (text, signal) => mutate(text, signal),
    };
}

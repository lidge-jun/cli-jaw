// ─── Durable queue-notice record writes ──────────────
// The store itself (`queue-notice-store.ts`) is deliberately a plain SQLite
// object with no logger and no opinion about failure. Every bot then wrapped it
// in the same three functions — reserve, attach, close — differing only in the
// channel literal and the log prefix, because the CONTRACT around those writes
// is not the store's: a durable write is a convenience for the NEXT boot, so
// letting it throw would fail the turn the user is actually waiting on.
//
// That contract is what lives here. The store stays a store.

import { log } from '../core/logger.js';
import { logErrorText } from './redact.js';
import { getQueueNoticeStore } from './queue-notice-store.js';
import type { MessengerChannel, RemoteTarget } from './types.js';

export type QueueNoticeRecorder = {
    /** Claim the row BEFORE the notice is posted. */
    reserve(requestId: string, target: RemoteTarget): void;
    /** Bind the posted message id to its reservation. */
    attach(requestId: string, messageId: string): void;
    /** Drop the record. */
    close(requestId: string): void;
};

/**
 * Best-effort durable-notice writes for one channel.
 *
 * `logPrefix` is the channel's own log tag rather than something derived from
 * `channel`: Telegram logs under `[tg:…]` while its channel literal is
 * `telegram`, and existing log greps depend on that.
 */
export function createQueueNoticeRecorder(
    channel: MessengerChannel,
    logPrefix: string,
): QueueNoticeRecorder {
    return {
        reserve(requestId: string, target: RemoteTarget): void {
            try {
                getQueueNoticeStore()?.reserve({ requestId, channel, target });
            } catch (e) {
                log.info(`${logPrefix} reserve failed`, logErrorText(e));
            }
        },
        attach(requestId: string, messageId: string): void {
            try {
                getQueueNoticeStore()?.attachMessageId(requestId, messageId);
            } catch (e) {
                log.info(`${logPrefix} attach failed`, logErrorText(e));
            }
        },
        close(requestId: string): void {
            try {
                getQueueNoticeStore()?.close(requestId);
            } catch (e) {
                log.info(`${logPrefix} close failed`, logErrorText(e));
            }
        },
    };
}

import { InputFile, type Bot } from 'grammy';
import fs from 'node:fs';
import { stripUndefined } from '../core/strip-undefined.js';
import { log } from '../core/logger.js';
import { redactOutboundText, logErrorText, userErrorText } from '../messaging/redact.js';
import { abortableDelay } from '../messaging/outbound-lifecycle.js';
import { deliveryFailed, deliverySent, type LiveDeliveryFields } from '../messaging/delivery-outcome.js';
import { classifySendFailure, retryAfterMs as vendorRetryAfterMs } from '../messaging/retry.js';
import {
    FILE_UNCONFIRMED_STATUS, TELEGRAM_FILE_UNCONFIRMED, type FileConfirmation,
} from '../messaging/file-receipt.js';

interface TelegramApiErrorLike {
    error_code?: number;
    statusCode?: number;
    code?: string;
    message?: string;
    parameters?: { retry_after?: number };
    constructor?: { name?: string };
}

function asTgErr(err: unknown): TelegramApiErrorLike {
    return (err && typeof err === 'object') ? (err as TelegramApiErrorLike) : {};
}

// Telegram Bot API file size limits (bytes)
// https://core.telegram.org/bots/api#sendphoto / #senddocument / #sendvoice
export const TELEGRAM_LIMITS: Record<string, number> = {
    document: 50 * 1024 * 1024,   // 50 MB
    photo: 10 * 1024 * 1024,   // 10 MB
    voice: 50 * 1024 * 1024,   // 50 MB
};

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;       // single retry delay cap
const MAX_TOTAL_WAIT_MS = 60_000;  // cumulative wait cap

/**
 * Pre-validate file size against Telegram limits.
 * Throws with descriptive message if exceeded.
 */
export function validateFileSize(filePath: string, type: string): void {
    // stat first: the early return on an unknown type skipped every check,
    // so a zero-byte file went out whenever the caller passed a type this
    // table does not list.
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
        throw Object.assign(
            new Error('Refusing to send a zero-byte file'),
            { code: 'FILE_EMPTY', statusCode: 400 },
        );
    }
    const limit = TELEGRAM_LIMITS[type];
    if (!limit) return;
    if (stat.size > limit) {
        const limitMB = (limit / 1024 / 1024).toFixed(0);
        const actualMB = (stat.size / 1024 / 1024).toFixed(1);
        throw Object.assign(
            new Error(`File too large for Telegram ${type}: ${actualMB}MB (limit: ${limitMB}MB)`),
            { code: 'FILE_TOO_LARGE', statusCode: 400 },
        );
    }
}

/** Classify error as transient (retryable) using grammY error types. */
function isTransient(err: unknown): boolean {
    const e = asTgErr(err);
    if (typeof e.error_code === 'number') {
        if (e.error_code === 429) return true;
        if (e.error_code >= 500) return true;
        return false;
    }
    if (e.constructor?.name === 'HttpError') return true;
    const code = e.code || '';
    if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE/.test(code)) return true;
    return false;
}

function getRetryAfterMs(err: unknown): number {
    // Delegates to the shared reader so the file path honours the same hints
    // the text path does.
    return vendorRetryAfterMs(err);
}

/** Determine upstream error category for HTTP response code. */
export function classifyUpstreamError(err: unknown): number {
    const e = asTgErr(err);
    if (e.error_code === 429) return 429;
    return 502; // 5xx or network
}

/**
 * Send a file to Telegram with exponential backoff retry.
 * Creates a fresh InputFile per attempt (stream safety).
 *
 * Size validation happens HERE rather than at the call sites. Leaving it to
 * callers meant the Telegram Hub, which calls this directly, uploaded
 * zero-byte files while every other path refused them.
 */
export async function sendTelegramFile(
    bot: Bot,
    chatId: number | string,
    filePath: string,
    type: string,
    opts?: { caption?: string; threadId?: number; signal?: AbortSignal },
): Promise<{
    ok: boolean; attempts: number; error?: string; retryAfter?: number; statusCode?: number;
    /** Present once a send was actually attempted. Absent on a local refusal
     *  (missing file, size limit), which delivered nothing and is not
     *  "unconfirmed" in any useful sense. */
    confirmation?: FileConfirmation;
} & Partial<LiveDeliveryFields>> {
    // Validate here, not at the call sites. The Hub's outbound relay calls this
    // transport directly and skipped the check, which is how an empty document
    // still reached the API after the guard was added.
    try {
        validateFileSize(filePath, type);
    } catch (err: unknown) {
        const e = asTgErr(err);
        return stripUndefined({
            ok: false,
            attempts: 0,
            error: userErrorText(err),
            statusCode: e.statusCode ?? 400,
        });
    }
    // Captions reach the room like any other text, so they take the same
    // last-mile masking the message body does.
    const caption = opts?.caption === undefined ? undefined : redactOutboundText(opts.caption);
    const message_thread_id = opts?.threadId;   // P0: thread file sends into their topic
    let totalWaited = 0;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const file = new InputFile(filePath);
            let sentMessage: unknown;
            switch (type) {
                case 'voice':
                    sentMessage = await bot.api.sendVoice(chatId, file, stripUndefined({ caption, message_thread_id }), opts?.signal as never);
                    break;
                case 'photo':
                    sentMessage = await bot.api.sendPhoto(chatId, file, stripUndefined({ caption, message_thread_id }), opts?.signal as never);
                    break;
                case 'document':
                    sentMessage = await bot.api.sendDocument(chatId, file, stripUndefined({ caption, message_thread_id }), opts?.signal as never);
                    break;
                default:
                    return { ok: false, attempts: attempt, error: `unsupported type: ${type}`, statusCode: 400, ...deliveryFailed(null) };
            }
            // A Message with no usable id is not a delivered file. Telegram
            // documents message_id 0 as an ephemeral or server-scheduled
            // message that "will be unusable until it is actually sent", so a
            // zero is evidence AGAINST delivery rather than weak evidence for
            // it — and the old `String(rawId)` recorded it as a real id.
            //
            // A positive message_id is sufficient on its own. The media file_id
            // is a reuse handle, not proof this chat received anything, and
            // requiring it as well would report a truncated Message as
            // unconfirmed for a send that did land.
            const rawId = (sentMessage as { message_id?: unknown } | undefined)?.message_id;
            const messageId = typeof rawId === 'number' && Number.isFinite(rawId) && rawId > 0 ? String(rawId)
                : typeof rawId === 'string' && rawId.trim() && rawId.trim() !== '0' ? rawId.trim()
                : null;
            if (messageId === null) {
                return {
                    ok: false, attempts: attempt, confirmation: 'unconfirmed',
                    error: TELEGRAM_FILE_UNCONFIRMED, statusCode: FILE_UNCONFIRMED_STATUS,
                    ...deliveryFailed(null, { ambiguous: true }),
                };
            }
            return { ok: true, attempts: attempt, confirmation: 'confirmed', ...deliverySent(messageId) };
        } catch (err: unknown) {
            const e = asTgErr(err);
            // 429 is decided by the shared classifier so the file path and the
            // text path (messaging/retry.ts) agree on what a rate limit is; it
            // recognises statusCode/status 429 and a bare retry_after, which the
            // local error_code check misses. Everything else — 5xx, HttpError,
            // ETIMEDOUT/ECONNRESET/ECONNREFUSED/EPIPE — stays with isTransient,
            // because the shared classifier folds those into 'ambiguous' and
            // routing the retry decision through it would stop retrying them.
            const rateLimited = classifySendFailure(err) === 'rate-limit';
            const transient = isTransient(err) || rateLimited;
            if (!transient || attempt === MAX_RETRIES) {
                const sc = rateLimited ? 429
                    : transient ? classifyUpstreamError(err) : (e.error_code || e.statusCode || 500);
                log.error(`[telegram:file] failed after ${attempt} attempt(s):`, logErrorText(err));
                return stripUndefined({
                    ok: false, attempts: attempt,
                    // This object becomes an HTTP response body, so it is a
                    // credential sink in its own right — grammY puts the Bot
                    // API URL, token and all, in some error messages.
                    error: userErrorText(err) || 'unknown error',
                    retryAfter: rateLimited ? e.parameters?.retry_after : undefined,
                    statusCode: sc,
                });
            }

            const retryAfterMs = getRetryAfterMs(err);
            // If upstream demands more than MAX_DELAY_MS, bail immediately
            if (retryAfterMs > MAX_DELAY_MS) {
                log.error(`[telegram:file] retry_after ${retryAfterMs}ms exceeds cap, giving up`);
                return stripUndefined({
                    ok: false, attempts: attempt,
                    error: `retry_after too large: ${retryAfterMs}ms`,
                    retryAfter: e.parameters?.retry_after,
                    statusCode: 429,
                });
            }

            const delay = Math.max(retryAfterMs, BASE_DELAY_MS * Math.pow(2, attempt - 1));
            totalWaited += delay;
            if (totalWaited >= MAX_TOTAL_WAIT_MS) {
                log.error(`[telegram:file] total wait ${totalWaited}ms exceeds cap, giving up`);
                return {
                    ok: false, attempts: attempt,
                    error: `total retry wait exceeded ${MAX_TOTAL_WAIT_MS}ms`,
                    statusCode: classifyUpstreamError(err),
                };
            }

            log.warn(`[telegram:retry] attempt ${attempt}/${MAX_RETRIES} failed (${e.error_code || 'network'}), retrying in ${delay}ms...`);
            // Abortable (#417): a shutdown must not sit out the backoff window.
            await abortableDelay(delay, opts?.signal);
            if (opts?.signal?.aborted) {
                return { ok: false, attempts: attempt, error: 'telegram_send_aborted', statusCode: 499 };
            }
        }
    }
    return { ok: false, attempts: MAX_RETRIES, error: 'exhausted retries', statusCode: 502 };
}

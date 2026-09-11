import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { settings } from '../core/config.js';
import { chunkDiscordMessage } from './forwarder.js';
import { validateDiscordFileSize } from './discord-file.js';
import { redactOutboundText } from '../messaging/redact.js';
import {
    DiscordRestScheduler,
    type DiscordRestResult,
} from './rest-scheduler.js';
import {
    discordDeliveryError,
    deliverySent,
    type DeliveryFailure,
    type LiveDeliveryFields,
} from '../messaging/delivery-outcome.js';

export type DiscordSendClientResult =
    | { token: string; reason?: never; status?: never }
    | { token: null; reason: string; status: 400 | 503 };

let cachedScheduler: { token: string; scheduler: DiscordRestScheduler } | null = null;

export function invalidateDiscordSendClient(): void {
    cachedScheduler?.scheduler.close();
    cachedScheduler = null;
}

export function getDiscordSendClient(): DiscordSendClientResult {
    const dc = settings["discord"];
    if (!dc?.enabled) {
        return { token: null, reason: 'discord_disabled', status: 503 };
    }
    const token = typeof dc.token === 'string' ? dc.token.trim() : '';
    if (!token) {
        return { token: null, reason: 'discord_token_missing', status: 503 };
    }
    return { token };
}

export type DiscordRestSendResult =
    | ({ ok: true; failure?: never; error?: never; status?: never } & LiveDeliveryFields)
    | { ok: false; failure: DeliveryFailure; error: string; status?: number };

/** Discord answers a message POST with the created message as JSON. The id was
 *  being thrown away by a parse that returned undefined, so nothing downstream
 *  could say WHICH message had been sent (#687).
 *
 *  Parse failures are swallowed rather than raised: a 204, an empty body or a
 *  shape we do not recognise still means the message was posted, and letting
 *  the scheduler turn that into ok:false would invent a transport failure out
 *  of a successful send. */
async function parseDiscordMessageId(response: Response): Promise<string | null> {
    try {
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
        const id = (body as { id?: unknown }).id;
        return typeof id === 'string' && id.length > 0 ? id : null;
    } catch {
        return null;
    }
}

function schedulerFor(token: string): DiscordRestScheduler {
    if (cachedScheduler?.token === token) return cachedScheduler.scheduler;
    cachedScheduler?.scheduler.close();
    const scheduler = new DiscordRestScheduler({ token });
    cachedScheduler = { token, scheduler };
    return scheduler;
}

function sendResult<T>(result: DiscordRestResult<T>): DiscordRestSendResult {
    if (result.ok) return { ok: true, ...deliverySent(typeof result.value === 'string' ? result.value : null) };
    return {
        ok: false,
        failure: result.failure,
        error: result.failure.message,
        ...('status' in result && result.status !== undefined ? { status: result.status } : {}),
    };
}

export async function sendDiscordTextRest(
    token: string,
    channelId: string,
    text: string,
    extra?: {
        components?: unknown;
        signal?: AbortSignal;
        requireBodyDelivery?: boolean;
        /**
         * Test seam: production passes nothing and gets the cached per-token
         * scheduler. Without an injection point the cancellation tests can only
         * reach the real scheduler, which owns rate-limit timers and a live
         * socket — so they would assert against a stub of the wrong layer, or
         * not run at all. `openDiscordDm` already takes `fetchImpl` for the
         * same reason; this is that convention one level up.
         */
        scheduler?: DiscordRestScheduler;
    },
): Promise<DiscordRestSendResult> {
    const scheduler = extra?.scheduler ?? schedulerFor(token);
    const chunks = chunkDiscordMessage(text);
    if (extra?.requireBodyDelivery && !chunks.some(chunk => chunk.trim().length > 0)) {
        return { ok: false, status: 400, error: 'discord_empty_message',
            failure: { kind: 'format', retryAfterMs: 0, code: 'empty_message', message: 'discord_empty_message' } };
    }
    let firstId: string | null = null;
    for (const [index, chunk] of chunks.entries()) {
        // A shutdown abort between chunks is a cancellation, not a vendor
        // failure (#417).
        if (extra?.signal?.aborted) {
            return {
                ok: false,
                failure: { kind: 'transient', retryAfterMs: 0, code: 'aborted', message: 'discord_send_aborted' },
                error: 'discord_send_aborted',
                status: 499,
            };
        }
        const body: Record<string, unknown> = { content: chunk };
        if (index === 0 && extra?.components) body['components'] = extra.components;
        const result = await scheduler.schedule({
            method: 'POST',
            path: `/channels/${encodeURIComponent(channelId)}/messages`,
            routeKey: 'POST:/channels/:channel/messages',
            majorKey: channelId,
            ...(extra?.signal ? { signal: extra.signal } : {}),
            makeInit: () => ({
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }),
            parse: parseDiscordMessageId,
        });
        if (!result.ok) return sendResult(result);
        // First chunk wins, the same rule Slack uses for firstTs.
        if (index === 0 && typeof result.value === 'string') firstId = result.value;
    }
    return { ok: true, ...deliverySent(firstId) };
}

export async function openDiscordDm(token: string, userId: string, fetchImpl?: typeof fetch): Promise<{ ok: true; channelId: string } | { ok: false; error: string }> {
    const scheduler = fetchImpl ? new DiscordRestScheduler({ token, fetchImpl }) : schedulerFor(token);
    const result = await scheduler.schedule<{ id?: string }>({
        method: 'POST',
        path: '/users/@me/channels',
        routeKey: 'POST:/users/@me/channels',
        majorKey: '@me',
        makeInit: () => ({
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient_id: userId }),
        }),
        parse: response => response.json() as Promise<{ id?: string }>,
    });
    if (!result.ok || !result.value?.id) return { ok: false, error: result.ok ? 'discord_dm_channel_missing' : result.failure.message };
    return { ok: true, channelId: result.value.id };
}

export async function sendDiscordDm(
    token: string,
    userId: string,
    text: string,
    fetchImpl?: typeof fetch,
    extra?: { components?: unknown },
): Promise<DiscordRestSendResult> {
    const dm = await openDiscordDm(token, userId, fetchImpl);
    if (!dm.ok) return { ok: false, failure: discordDeliveryError({ channel: 'discord', message: dm.error, dispatched: false }), error: dm.error };
    if (!fetchImpl) return sendDiscordTextRest(token, dm.channelId, text, extra);
    const scheduler = new DiscordRestScheduler({ token, fetchImpl });
    const chunks = chunkDiscordMessage(text);
    let firstId: string | null = null;
    for (const [index, chunk] of chunks.entries()) {
        const body: Record<string, unknown> = { content: chunk };
        if (index === 0 && extra?.components) body['components'] = extra.components;
        const result = await scheduler.schedule({ method: 'POST', path: `/channels/${encodeURIComponent(dm.channelId)}/messages`, routeKey: 'POST:/channels/:channel/messages', majorKey: dm.channelId, makeInit: () => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), parse: parseDiscordMessageId });
        if (!result.ok) return sendResult(result);
        if (index === 0 && typeof result.value === 'string') firstId = result.value;
    }
    return { ok: true, ...deliverySent(firstId) };
}

export async function sendDiscordFileRest(
    token: string,
    channelId: string,
    filePath: string,
    caption?: string,
    extra?: { signal?: AbortSignal },
): Promise<DiscordRestSendResult> {
    try {
        if (extra?.signal?.aborted) {
            return {
                ok: false,
                failure: { kind: 'transient', retryAfterMs: 0, code: 'aborted', message: 'discord_send_aborted' },
                error: 'discord_send_aborted',
                status: 499,
            };
        }
        const buffer = await readFile(filePath);
        validateDiscordFileSize(filePath, buffer.length);
        const safeCaption = caption?.trim() ? redactOutboundText(caption.trim()) : '';
        const result = await schedulerFor(token).schedule({
            method: 'POST',
            path: `/channels/${encodeURIComponent(channelId)}/messages`,
            routeKey: 'POST:/channels/:channel/messages',
            majorKey: channelId,
            ...(extra?.signal ? { signal: extra.signal } : {}),
            makeInit: () => {
                const form = new FormData();
                form.append('files[0]', new Blob([buffer]), basename(filePath));
                if (safeCaption) {
                    form.append('payload_json', JSON.stringify({ content: safeCaption }));
                }
                return { body: form };
            },
            parse: parseDiscordMessageId,
        });
        return sendResult(result);
    } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        const failure = discordDeliveryError({
            channel: 'discord',
            ...(statusCode === undefined ? {} : { status: statusCode }),
            message: error instanceof Error ? error.message : String(error),
            dispatched: false,
            cause: error,
        });
        return {
            ok: false,
            failure,
            error: failure.message,
            ...(statusCode === undefined ? {} : { status: statusCode }),
        };
    }
}

// ─── Discord File Send ───────────────────────────────
// Outbound file delivery for Discord.
// Default 10 MiB cap matches Discord's non-Nitro/non-boosted limit.
// Boosted servers (Level 2+) allow up to 50 MiB — adjust DISCORD_LIMITS if needed.

import type { Client } from 'discord.js';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { RemoteTarget } from '../messaging/types.js';
import { asSendable } from './channel-types.js';
import { redactOutboundText, userErrorText } from '../messaging/redact.js';
import { sendDiscordFileRest } from './send-only-client.js';
import { deliveryFailed, deliverySent, type LiveDeliveryFields } from '../messaging/delivery-outcome.js';
import {
    DISCORD_FILE_UNCONFIRMED, FILE_UNCONFIRMED_STATUS, type FileConfirmation,
} from '../messaging/file-receipt.js';

export const DISCORD_LIMITS = {
    document: 10 * 1024 * 1024,
    photo: 10 * 1024 * 1024,
    voice: 10 * 1024 * 1024,
};

export function validateDiscordFileSize(_filePath: string, size: number) {
    // Slack has refused these since it shipped. Discord only checked the upper
    // bound, so an empty file travelled all the way to the API for a 400.
    if (size === 0) {
        throw Object.assign(
            new Error('Refusing to send a zero-byte file'),
            { statusCode: 400 },
        );
    }
    if (size > DISCORD_LIMITS.document) {
        throw Object.assign(
            new Error(`File exceeds Discord 10 MiB limit: ${(size / 1024 / 1024).toFixed(1)} MiB`),
            { statusCode: 413 },
        );
    }
}

export async function sendDiscordFile(
    client: Client,
    target: RemoteTarget,
    filePath: string,
    options?: { caption?: string; replyTo?: string; signal?: AbortSignal },
): Promise<{
    ok: boolean; error?: string; status?: number;
    /** Present once a send was attempted; absent on a local refusal. */
    confirmation?: FileConfirmation;
} & Partial<LiveDeliveryFields>> {
    let fileStat;
    try {
        fileStat = await stat(filePath);
    } catch {
        return { ok: false, error: `File not found: ${filePath}` };
    }
    validateDiscordFileSize(filePath, fileStat.size);

    // Thread-aware: prefer threadId over targetId
    const resolvedId = target.threadId || target.targetId;
    // Cancellable REST first (#417): sendable.send() ignores AbortSignal, so a
    // shutdown could never abort the upload. The token lives on the client.
    if (client.token) {
        const rest = await sendDiscordFileRest(client.token, resolvedId, filePath,
            options?.caption, options?.signal ? { signal: options.signal } : {});
        // Forward the whole verdict. Collapsing a failure to { ok, error } threw
        // `confirmation` away on the path that actually runs in production — a
        // connected gateway client is the normal case — and `sendChannelOutput`
        // needs that field to tell an unconfirmed upload (whose caption may
        // already be on screen) from a refusal that delivered nothing.
        if (rest.ok) {
            return { ok: true, confirmation: rest.confirmation ?? 'confirmed', ...deliverySent(rest.platformMessageId) };
        }
        return {
            ok: false, error: rest.error,
            ...(rest.confirmation ? { confirmation: rest.confirmation } : {}),
            ...(rest.status !== undefined ? { status: rest.status } : {}),
            ...deliveryFailed(null, { ambiguous: rest.confirmation === 'unconfirmed' }),
        };
    }
    const channel = await client.channels.fetch(resolvedId);
    const sendable = asSendable(channel);
    if (!sendable) {
        return { ok: false, error: 'Target channel not text-based' };
    }

    try {
        // discord.js returns the created Message here, but `asSendable` types
        // `send` as Promise<unknown>, so the id is narrowed rather than assumed.
        const sent: unknown = await sendable.send({
            content: redactOutboundText(options?.caption || ''),
            files: [{ attachment: filePath, name: basename(filePath) }],
        });
        const rawId = (sent as { id?: unknown } | null | undefined)?.id;
        const messageId = typeof rawId === 'string' && rawId.trim() ? rawId : null;
        if (messageId === null) {
            return {
                ok: false, confirmation: 'unconfirmed',
                error: DISCORD_FILE_UNCONFIRMED, status: FILE_UNCONFIRMED_STATUS,
                ...deliveryFailed(null, { ambiguous: true }),
            };
        }
        return { ok: true, confirmation: 'confirmed', ...deliverySent(messageId) };
    } catch (e) {
        return { ok: false, error: `Discord file send failed: ${userErrorText(e)}` };
    }
}

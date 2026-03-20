// ─── Messaging Send ──────────────────────────────────
// Unified outbound message routing for all channels.

import { settings } from '../core/config.js';
import type { MessengerChannel, OutboundType, RemoteTarget } from './types.js';
import { getLastActiveTarget, getLatestSeenTarget } from './runtime.js';

// ─── Request Model ──────────────────────────────────

export type ChannelSendRequest = {
    channel?: MessengerChannel | 'active';
    type: OutboundType;
    text?: string;
    filePath?: string;
    caption?: string;
    target?: RemoteTarget;
    chatId?: string | number;
};

// ─── Transport Send Registry ────────────────────────

type TransportSendFn = (req: ChannelSendRequest) => Promise<{ ok: boolean; error?: string; [k: string]: any }>;

const sendFns = new Map<MessengerChannel, TransportSendFn>();

export function registerSendTransport(channel: MessengerChannel, fn: TransportSendFn) {
    sendFns.set(channel, fn);
}

// ─── Normalize ──────────────────────────────────────

export function normalizeChannelSendRequest(body: Record<string, any>): ChannelSendRequest {
    return {
        channel: body.channel || 'active',
        type: (body.type || 'text') as OutboundType,
        text: body.text,
        filePath: body.file_path || body.filePath,
        caption: body.caption,
        target: body.target,
        chatId: body.chat_id || body.chatId,
    };
}

// ─── Resolve Target ─────────────────────────────────

function resolveChannel(req: ChannelSendRequest): MessengerChannel {
    if (req.channel && req.channel !== 'active') return req.channel;
    return (settings.channel as MessengerChannel) || 'telegram';
}

// ─── Send ───────────────────────────────────────────

/**
 * Resolve configured fallback target from settings.
 * Used when no lastActive or latestSeen target is available.
 */
function getConfiguredFallbackTarget(channel: MessengerChannel): RemoteTarget | null {
    if (channel === 'telegram') {
        const chatIds = settings.telegram?.allowedChatIds;
        if (chatIds?.length) {
            return {
                channel: 'telegram',
                targetKind: 'user',
                peerKind: 'direct',
                targetId: String(chatIds[0]),
            };
        }
    } else if (channel === 'discord') {
        const channelIds = settings.discord?.channelIds;
        if (channelIds?.length) {
            return {
                channel: 'discord',
                targetKind: 'channel',
                peerKind: 'channel',
                targetId: String(channelIds[0]),
            };
        }
    }
    return null;
}

export async function sendChannelOutput(req: ChannelSendRequest): Promise<{ ok: boolean; error?: string; [k: string]: any }> {
    const channel = resolveChannel(req);

    // Resolve target: explicit > lastActive > latestSeen > configured fallback > error
    if (!req.target) {
        const last = getLastActiveTarget(channel);
        if (last) {
            req.target = last;
        } else {
            const seen = getLatestSeenTarget(channel);
            if (seen) {
                req.target = seen;
            } else {
                const fallback = getConfiguredFallbackTarget(channel);
                if (fallback) req.target = fallback;
            }
        }
    }

    if (!req.target && !req.chatId) {
        return { ok: false, error: `No target available for ${channel} — send a message first or configure fallback IDs` };
    }

    const sendFn = sendFns.get(channel);
    if (!sendFn) {
        return { ok: false, error: `No send transport registered for ${channel}` };
    }

    return sendFn(req);
}

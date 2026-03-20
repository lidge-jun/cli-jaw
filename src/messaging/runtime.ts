// ─── Messaging Runtime ───────────────────────────────
// Active channel runtime lifecycle: init, shutdown, restart.
// Transport modules register themselves via registerTransport() to avoid circular deps.

import { settings } from '../core/config.js';
import type { MessengerChannel, RemoteTarget } from './types.js';

// ─── Transport Registry (push-based, no circular imports) ─────

type TransportFns = {
    init: () => Promise<void>;
    shutdown: () => Promise<void>;
};

const transports = new Map<MessengerChannel, TransportFns>();

export function registerTransport(channel: MessengerChannel, fns: TransportFns) {
    transports.set(channel, fns);
}

// ─── Last Active / Latest Seen Target State ─────────

const lastActiveTargets = new Map<MessengerChannel, RemoteTarget | null>();
const latestSeenTargets = new Map<MessengerChannel, RemoteTarget | null>();

export function getLastActiveTarget(channel: MessengerChannel): RemoteTarget | null {
    return lastActiveTargets.get(channel) ?? null;
}

export function setLastActiveTarget(channel: MessengerChannel, target: RemoteTarget) {
    lastActiveTargets.set(channel, target);
}

export function getLatestSeenTarget(channel: MessengerChannel): RemoteTarget | null {
    return latestSeenTargets.get(channel) ?? null;
}

export function setLatestSeenTarget(channel: MessengerChannel, target: RemoteTarget) {
    latestSeenTargets.set(channel, target);
}

export function clearTargetState(channel?: MessengerChannel) {
    if (channel) {
        lastActiveTargets.delete(channel);
        latestSeenTargets.delete(channel);
    } else {
        lastActiveTargets.clear();
        latestSeenTargets.clear();
    }
}

/** Hydrate target state from persisted settings.messaging */
export function hydrateTargetsFromSettings(s: Record<string, any>) {
    const messaging = s?.messaging;
    if (!messaging) return;
    for (const ch of ['telegram', 'discord'] as MessengerChannel[]) {
        if (messaging.lastActive?.[ch]) {
            lastActiveTargets.set(ch, messaging.lastActive[ch]);
        }
        if (messaging.latestSeen?.[ch]) {
            latestSeenTargets.set(ch, messaging.latestSeen[ch]);
        }
    }
}

// ─── Lifecycle ──────────────────────────────────────

export function getActiveChannel(): MessengerChannel {
    return (settings.channel as MessengerChannel) || 'telegram';
}

export async function initActiveMessagingRuntime() {
    const channel = getActiveChannel();
    const transport = transports.get(channel);
    if (transport) {
        await transport.init();
    } else {
        console.log(`[messaging] no transport registered for ${channel}`);
    }
}

export async function shutdownMessagingRuntime() {
    for (const [name, transport] of transports) {
        try {
            await transport.shutdown();
        } catch (e) {
            console.warn(`[messaging] ${name} shutdown error:`, (e as Error).message);
        }
    }
}

export async function restartMessagingRuntime(
    prev: Record<string, any>,
    next: Record<string, any>,
    patch: Record<string, any>,
) {
    const prevChannel = prev.channel || 'telegram';
    const nextChannel = next.channel || 'telegram';

    // Only restart if active channel changed, or the active channel's config changed
    const channelSwitched = prevChannel !== nextChannel;
    const activeChannelPatched = !!patch[nextChannel as string];
    const localeSwitched = patch.locale !== undefined;

    // Inactive channel config change should NOT trigger restart
    if (!channelSwitched && !activeChannelPatched && !localeSwitched) return;

    // Clear stale targets on restart to prevent routing to previous channel/thread
    clearTargetState();

    await shutdownMessagingRuntime();
    await initActiveMessagingRuntime();
}

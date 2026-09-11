// ─── Heartbeat destination binding ───────────────────
// A scheduled report is written for one conversation. An operator picked it;
// nothing about the job says "wherever someone last spoke". Yet a job with no
// stored destination used to fall through to the active-channel path, and a job
// that stored only a channel was delivered to that channel's root with no way to
// tell an intentional root post from a half-filled form (#437, #745).
//
// So a destination is either complete or it is held. Complete means a thread —
// the conversation the operator pointed at — or an explicit `channel_root`
// saying the channel itself is the intended audience. A job that says neither
// has not been configured yet, and the honest response to that is silence with
// a reason in the log, not a guess that lands in someone else's thread.

import { isHeartbeatDestination, type HeartbeatDestination } from '../core/config.js';
import { targetFromChatId } from '../messaging/send.js';
import type { RemoteTarget } from '../messaging/types.js';

export type HeartbeatHoldReason =
    | 'unbound_destination'
    | 'incomplete_destination'
    | 'malformed_destination';

export type HeartbeatBinding =
    | { state: 'bound'; target: RemoteTarget }
    | { state: 'held'; reason: HeartbeatHoldReason };

/** True when a stored destination names a conversation precisely enough to send.
 *
 *  Slack is the strict case because Slack is where threads exist: either a
 *  non-empty `threadId`, or `scope: 'channel_root'` written on purpose. An
 *  empty-string `threadId` is not a thread; it used to pass validation and then
 *  read as falsy at send time, quietly turning a threaded job into a root post. */
export function isCompleteHeartbeatDestination(value: unknown): value is HeartbeatDestination {
    if (!isHeartbeatDestination(value)) return false;
    const dest = value as HeartbeatDestination;
    if (dest.threadId !== undefined && !dest.threadId.trim()) return false;
    if (dest.channel !== 'slack') return true;
    return Boolean(dest.threadId?.trim()) || dest.scope === 'channel_root';
}

/**
 * Resolve a stored destination into the one target this job may use.
 *
 * There is deliberately no "no destination" success case. The previous contract
 * had one, and it is the reason a report reached a conversation that had never
 * asked for it.
 */
export function resolveHeartbeatBinding(destination: unknown): HeartbeatBinding {
    if (destination === undefined || destination === null) {
        return { state: 'held', reason: 'unbound_destination' };
    }
    if (!isHeartbeatDestination(destination)) {
        return { state: 'held', reason: 'malformed_destination' };
    }
    if (!isCompleteHeartbeatDestination(destination)) {
        return { state: 'held', reason: 'incomplete_destination' };
    }
    const dest = destination as HeartbeatDestination;
    const base = targetFromChatId(dest.channel, dest.targetId);
    const threadId = dest.threadId?.trim();
    return { state: 'bound', target: threadId ? { ...base, threadId } : base };
}

/** Operator-facing explanation. Never includes tokens or report content. */
export function heartbeatHoldMessage(reason: HeartbeatHoldReason): string {
    switch (reason) {
        case 'unbound_destination':
            return 'no destination configured — set a channel and thread before enabling';
        case 'incomplete_destination':
            return 'destination names a channel but no thread — add a thread, or set scope:"channel_root" to post to the channel itself';
        case 'malformed_destination':
            return 'destination is malformed';
    }
}

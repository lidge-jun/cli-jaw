// ─── Standing target-reply admission ─────────────────
// Each chat bot installs a standing `orchestrate_done` listener so an answer
// whose waiter is gone still reaches the conversation it was asked in. A
// restart destroys the live waiter; a mid-run steer leaves the follow-up answer
// with no waiter at all (#655); a queued turn's dispatcher may never have
// existed. Without the listener the user's message simply vanishes.
//
// The three listeners had drifted into three different guards for the same
// decision, and the drift was invisible: Discord admitted only `fromQueue`,
// Telegram only `replyViaTarget`, Slack all three. Which identities a channel
// admits is a real per-channel decision — a channel whose dispatch path already
// answers ordinary turns must not answer them here too, or the user sees the
// reply twice. So the difference is kept, but as DATA (`accept`) rather than as
// three hand-maintained control flows.
//
// What this owns is admission only: is this event mine, is the target a real
// address on my channel, and is somebody else already going to answer it. The
// send, the queue-notice close, the image relay and the elicitation keyboards
// stay in the bot, because those differ in substance and not just in shape.
//
// This is NOT `shouldSkipForwarding` (forwarder-origin.ts). That one governs the
// last-active `agent_done` forwarders, a different event and a different job.

import { requiresNativeBodyDelivery } from './native-body.js';
import { isRemoteTarget, type MessengerChannel, type RemoteTarget } from './types.js';

/**
 * Why this turn has no waiter of its own.
 *
 * - `fromQueue`: it was restored from the queue, possibly after a restart.
 * - `fromSteer`: a steer retired the run that owned it (#655).
 * - `replyViaTarget`: it was forwarded in carrying its own destination.
 */
export type TargetReplyIdentity = 'fromQueue' | 'fromSteer' | 'replyViaTarget';

export type TargetReplyGuardOptions = {
    /** The asking channel. Matched against both `origin` and `target.channel`. */
    channel: MessengerChannel;
    /** Broadcast event this forwarder listens for. */
    event: string;
    /** Identities this channel accepts. An empty list admits nothing. */
    accept: readonly TargetReplyIdentity[];
    /** Reject a falsy `text` at admission, before any target work. */
    requireText?: boolean;
    /** A live requester already listening for this exact result. */
    hasPendingWaiter?: (requestId: string) => boolean;
    /** Shutdown latch; checked first so a stopping channel admits nothing. */
    stopping?: () => boolean;
};

export type AdmittedTargetReply = {
    /** Validated address. A copy, so a listener cannot mutate the payload's. */
    target: RemoteTarget;
    /** Empty string when the payload carried no string request id. */
    requestId: string;
    /** `data.text` as a string. Channels that rewrite it (Slack's error copy)
     *  compute their own and ignore this. */
    text: string;
    requireBodyDelivery: boolean;
};

/**
 * Decide whether this broadcast is a target reply this channel must deliver.
 *
 * Returns null for every rejection. Nothing here has a side effect, so the
 * order of the checks is observational only; it runs cheapest-first.
 *
 * The empty-native-body skip is deliberately NOT done here. Telegram and
 * Discord drop those at admission, but Slack drops them inside its delivery
 * lane, after the delivery ledger has been entered. Moving Slack's check
 * earlier would change which runs the ledger ever sees.
 */
export function admitTargetReply(
    type: string,
    data: Record<string, unknown>,
    options: TargetReplyGuardOptions,
): AdmittedTargetReply | null {
    if (options.stopping?.()) return null;
    if (type !== options.event) return null;
    if (data['origin'] !== options.channel) return null;
    if (options.requireText && !data['text']) return null;
    if (!options.accept.some(identity => data[identity] === true)) return null;

    // A cast is not a check. Telegram and Discord used to take the payload's
    // target on trust, which let a malformed address (an empty `targetId`, say)
    // through to a transport that then fell back to the last-active chat — the
    // answer lands in a conversation nobody asked in. Validate the address.
    const rawTarget = data['target'];
    if (!isRemoteTarget(rawTarget) || rawTarget.channel !== options.channel) return null;

    // Matches the historical guards: any truthy request id is stringified for
    // the waiter lookup, while the returned id stays string-typed.
    const rawRequestId = data['requestId'];
    if (rawRequestId && options.hasPendingWaiter?.(String(rawRequestId))) return null;

    return {
        target: { ...rawTarget },
        requestId: typeof rawRequestId === 'string' ? rawRequestId : '',
        text: String(data['text'] ?? ''),
        requireBodyDelivery: requiresNativeBodyDelivery(data),
    };
}

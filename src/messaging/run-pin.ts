// ─── Run pin ─────────────────────────────────────────
// A run's identity, captured when it is admitted and carried on every terminal
// event it emits. Two separate failures made this necessary on 2026-09-11.
//
// The destination one: `agent_done` said what was said but not who it was for,
// so each channel forwarder answered "who for?" from a global last-active slot.
// A mention that arrived mid-run moved that slot, and an unrelated run's answer
// followed it into the wrong conversation (#742).
//
// The identity one: the print exit path broadcast `agent_done` with nothing but
// `origin`, and the Slack matcher treated every absent field as agreement. An
// event that cannot say which run produced it could therefore be adopted by a
// waiter that could (#743).
//
// Both are the same mistake in different clothes: inferring a run's context
// from process-global state instead of carrying it. A pin is carried.

import type { RemoteTarget } from './types.js';

export interface RunPin {
    origin?: string | undefined;
    requestId?: string | undefined;
    scope?: string | undefined;
    sessionId?: string | undefined;
    remoteKey?: string | undefined;
    target?: RemoteTarget | undefined;
}

/**
 * The identity block to spread into a terminal event payload.
 *
 * Absent values are omitted rather than sent as `undefined`, because consumers
 * distinguish "this run has no remote destination" from "this producer forgot
 * to say". The target is copied: a payload that aliased the live run meta would
 * change under a reader when the next turn overwrote it.
 */
export function runPinFields(pin: RunPin): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    if (pin.origin) fields['origin'] = pin.origin;
    if (pin.requestId) fields['requestId'] = pin.requestId;
    if (pin.scope) fields['scope'] = pin.scope;
    if (pin.sessionId) fields['sessionId'] = pin.sessionId;
    if (pin.remoteKey) fields['remoteKey'] = pin.remoteKey;
    if (pin.target && typeof pin.target.targetId === 'string' && pin.target.targetId) {
        fields['target'] = { ...pin.target };
    }
    return fields;
}

/** True when the payload carries the execution identity a waiter can check. */
export function hasRunIdentity(data: Record<string, unknown>): boolean {
    return typeof data['scope'] === 'string' && typeof data['sessionId'] === 'string';
}

/**
 * True when two runs belong to the same conversation.
 *
 * A remote key is the conversation. If either side has one they must agree; a
 * web turn (no key) and a Slack thread (key) are never the same conversation,
 * which is what makes it wrong to steer one with the other.
 */
export function sameRunConversation(a: RunPin, b: RunPin): boolean {
    if (a.remoteKey || b.remoteKey) return a.remoteKey === b.remoteKey;
    return (a.origin ?? '') === (b.origin ?? '');
}

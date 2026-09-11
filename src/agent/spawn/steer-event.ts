// ─── The identity a steer announces ───
//
// Three steer modes broadcast `steer_started`, and each one built the payload from its
// own hand-written field list. Two consumers depend on those fields: the collector
// retires a turn only when `scope`, `sessionId` and a DIFFERING `requestId` line up
// (`orchestrator/collect.ts:129-133`), and the Slack reply-control observer switches on
// `mode` (`slack/bot.ts:521`, `:557`). A mode that dropped one field silently stopped
// retiring the turn it replaced, which is how a steered Slack turn posted the
// "no response" placeholder into a user's thread (suji, 2026-09-09).
//
// A leaf module so a regression can assert against the payload production actually
// sends without importing spawn.ts and the server graph behind it.

export type SteerStartedMeta = {
    target?: unknown;
    chatId?: unknown;
    requestId?: unknown;
    remoteKey?: unknown;
    replyViaTarget?: unknown;
};

/** Which steer replaced the turn. Slack's reply control reads this. */
export type SteerMode = 'cancel-reprompt' | 'native-input' | 'kill-steer' | 'restart';

export function buildSteerStartedEvent(input: {
    prompt: string;
    source?: string | undefined;
    scopeKey: string;
    chatSessionId: string;
    meta?: SteerStartedMeta | undefined;
    mode: SteerMode;
    /** Mode-specific additions, e.g. the pre-kill Slack restart capture (#654). */
    extra?: Record<string, unknown> | undefined;
}): Record<string, unknown> {
    const event: Record<string, unknown> = {
        prompt: input.prompt,
        origin: input.source || 'web',
        scope: input.scopeKey,
        sessionId: input.chatSessionId,
        target: input.meta?.target,
        chatId: input.meta?.chatId,
        requestId: input.meta?.requestId,
        remoteKey: input.meta?.remoteKey,
        replyViaTarget: input.meta?.replyViaTarget,
        mode: input.mode,
        ...(input.extra ?? {}),
    };
    for (const key of Object.keys(event)) {
        if (event[key] === undefined) delete event[key];
    }
    return event;
}

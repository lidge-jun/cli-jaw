import type { CodeItem } from '../../../../src/code-mode/wire';
import type { CodeDraft } from './code-controller-drafts';

/**
 * A submitted prompt used to vanish between Send and the server's echo.
 *
 * The server does emit a `user_message` as soon as it accepts a turn, but that
 * arrives after an HTTP round trip and an SSE hop, and when acceptance is
 * unknown it may never arrive at all. Until then the transcript showed nothing,
 * so the text the user just wrote was simply gone from the screen.
 *
 * This is derived at read time rather than pushed into the session reducer:
 * that reducer applies strictly sequence-ordered server events, and inserting a
 * client-invented item would desynchronize its cursor. `clientTurnKey` is the
 * join key, so the real item replaces this one the moment it lands.
 */
export const PENDING_USER_ITEM_ID = 'pending:user';

export function pendingUserItem(draft: CodeDraft, items: CodeItem[], now = Date.now()): CodeItem | null {
    const retry = draft.retry;
    if (!retry) return null;
    // The server already spent the previous key, so nothing is in flight. This row
    // renders as "Sending"; showing it here would restate the very confusion the
    // re-key exists to remove. The failed attempt stays in history and the recovery
    // strip still previews the text.
    if (retry.resend) return null;
    // The authoritative item is here: show that one instead.
    if (items.some(item => item.kind === 'user_message' && item.clientTurnKey === retry.key)) return null;
    const unknown = draft.operation.kind === 'unknown-send';
    return {
        itemId: PENDING_USER_ITEM_ID,
        turnId: null,
        kind: 'user_message',
        // An unconfirmed send is not a failure and must not read as one; it is
        // still pending until the user retries or the echo arrives.
        status: 'pending',
        text: retry.text,
        clientTurnKey: retry.key,
        // Sorting is by firstSequence, so a large value keeps this last.
        firstSequence: Number.MAX_SAFE_INTEGER,
        createdAt: now,
        updatedAt: now,
        ...(unknown ? { phase: 'unknown' as const } : {}),
    };
}

/** Items to render: server history plus the not-yet-echoed prompt. */
export function withPendingUserItem(draft: CodeDraft, items: CodeItem[], now = Date.now()): CodeItem[] {
    const pending = pendingUserItem(draft, items, now);
    return pending ? [...items, pending] : items;
}

// ─── File delivery confirmation ──────────────────────
// `ok` and "we can prove it landed" were the same bit on two of the three
// channels, and they are not the same claim. Slack already refused a completion
// that did not echo the reserved file id back, because an intermediary
// answering {"ok":true} would otherwise be reported as a delivered upload.
// Telegram and Discord reported the same situation as success with
// `ambiguous: true` — a flag no consumer read.
//
// Both vendors document enough to decide it:
//
// - Telegram returns the sent Message. `message_id` is 0 for an ephemeral or
//   server-scheduled message, and the docs say that message "will be unusable
//   until it is actually sent". A zero id is therefore not weak proof, it is
//   proof of the opposite.
// - Discord's Create Message is documented to return a message object. 204 No
//   Content is documented only for reactions, deletes and unpin. An empty body
//   on a message POST means something other than Discord answered.
//
// `confirmation` is deliberately a TOP-LEVEL field on the send result.
// `sendChannelOutput` reads it to decide whether an unconfirmed send may still
// claim its caption, and a nested receipt would not be visible there.

export type FileConfirmation = 'confirmed' | 'unconfirmed';

/** Stable error codes, one per channel, so a caller can tell an unconfirmed
 *  send from a refusal without string-matching a vendor message. They also keep
 *  the result off `sendResultHttpStatus`'s bare-502 default, which reads to an
 *  agent as "retry me" — the one thing that must not happen when the upload may
 *  already have landed. */
export const SLACK_FILE_UNCONFIRMED = 'slack_file_completion_unconfirmed';
export const TELEGRAM_FILE_UNCONFIRMED = 'telegram_file_send_unconfirmed';
export const DISCORD_FILE_UNCONFIRMED = 'discord_file_send_unconfirmed';

/** Not 4xx: nothing about the request was wrong. Not a plain failure either —
 *  the bytes may well be on screen. */
export const FILE_UNCONFIRMED_STATUS = 502;

/**
 * True when a send failed only because the vendor would not name what it
 * accepted.
 *
 * The distinction matters exactly once, in `sendChannelOutput`: a hard refusal
 * (400, 413, auth) delivered nothing, so the turn's own answer must still be
 * posted; an unconfirmed send may already be on screen, so posting the same
 * caption again is the more visible harm.
 */
export function isUnconfirmedSend(result: { confirmation?: unknown } | null | undefined): boolean {
    return result?.confirmation === 'unconfirmed';
}

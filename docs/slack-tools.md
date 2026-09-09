# Slack tools

Use `jaw slack capabilities` to inspect registered operations and observed bot scopes. `implemented` describes server support, `granted` is the current scope observation (or unknown), `available` describes base prerequisites, and `verified` records a successful real operation under that credential. `conditionalScopes` lists conversation-dependent permissions; known requester-DM access and mutation readback scopes are included in `requiredScopes`. Resource access, workspace plan, and conversation restrictions are checked separately on each call. Parent-agent connectors do not provide tools to this bot.

Call `jaw slack tool --input-json '<JSON>'`. The server accepts explicit operations; it does not accept arbitrary Slack API methods. Supported fresh print-process Slack turns receive an expiring per-turn grant. Local operators may explicitly use `--operator` with their instance's separate operator credential.

All actions below take `operation` and `channel`. Mutations also require a unique `invocationId`. Repeating an identical completed invocation returns its saved receipt; conflicting, pending, or uncertain invocations cannot be sent again automatically.

| Operations | Additional input |
| --- | --- |
| `reaction.add`, `reaction.remove` | `ts`, `name` |
| `reaction.get` | `ts` |
| `message.update` | `ts`, optional `threadTs`, `text`, optional `blocks` |
| `message.delete` | `ts`, optional `threadTs` |
| `schedule.create` | Unix-seconds `postAt`, `text`, optional `blocks`, `threadTs` |
| `schedule.list` | None |
| `schedule.cancel` | `scheduledId` |
| `schedule.update` | `scheduledId` and changes to `postAt`, `text`, `blocks`, or `threadTs` |
| `pin.add`, `pin.remove` | `ts` |
| `pin.list`, `bookmark.list` | None |
| `bookmark.add` | `title`, HTTPS `link`, optional `emoji` |
| `bookmark.edit` | `bookmarkId`, changes to `title`, `link`, or `emoji` |
| `bookmark.remove` | `bookmarkId` |
| `canvas.create` | `title`, `markdown` |
| `canvas.read` | `canvasId` |
| `canvas.edit` | `canvasId`, `mode` (`append` or `replace`), `markdown`; replacement needs `sectionId` or explicit `replaceAll:true` |
| `list.create` | `name` |
| `list.read` | `listId`, optional `cursor`, `limit` (1–100) |
| `list.item.add` | `listId`, `fields` |
| `list.item.update` | `listId`, `rowId`, `fields`, optional `updatedTimestamp` |
| `interaction.url` | `text`, `buttons:[{text,url}]`, optional `threadTs` |
| `interaction.choice` | `text`, `choices:[{label,value}]`, optional `style` (`buttons` or `select`), `threadTs`, `expiresInSeconds` (1–900) |
| `interaction.get` | `interactionId` |
| `rts.reconcile` | Original publication `invocationId`, matching `threadTs` if applicable, optional `maxPages` (1–10) |

List fields use `{columnId,type,value}`. Supported types are `text`, `number`, `checkbox`, `date` (`YYYY-MM-DD`), and `user` (an array of user IDs). Unknown column schemas are rejected.

Message edits and deletion require the current bot's actual author identity. Reaction reads return reaction state, not the underlying message body. Pins and bookmarks use current conversation permission; their presence does not prove that the caller created them.

Schedules are tied to the exact creating credential. A changed token cannot prove that an older schedule disappeared. Updates cancel the old schedule and create a replacement; this is not atomic. Multi-message schedules can also finish partially. Receipts retain acknowledged IDs and never request blind retries. Slack does not support cancellation within the final 60 seconds, and scheduling never sends the problematic `metadata` parameter. List results identify incomplete scans and unresolved older credentials.

Canvas and List tools in Slack turns currently require a freshly verified requester/bot DM: requester access alone cannot authorize disclosure to a group. Writes require both the local ownership record and fresh requester write permission. DM Canvas creation uses a standalone document and requests direct write access for the captured requester; plan or sharing restrictions remain explicit and never trigger channel creation. Create/share acknowledgements do not prove requester visibility. Canvas content comes from the actual file download URL returned by Slack; missing access, unsupported format, incomplete content, and plan restrictions remain explicit.

Choices allow at most ten options and require the connected Socket transport. The server binds opaque controls to the captured requester, conversation, posted message, credential and expiry. A valid callback stores the selected value once; it does not execute code, an API method, or a model prompt. `interaction.get` reads that owned result. Choice verification in the catalog requires an observed callback; URL controls use posted-content readback. General modal opening is explicitly unsupported.

`rts.reconcile` sends no message and returns no source text. It can release only a terminal publication hold with matching ownership and exact scope after a complete scan proves the expected output count. Active publishers, incomplete scans, legacy holds, and crash records without terminal evidence remain protected. New RTS publication uses one payload and one POST attempt.

Source tools retain their separate shapes: `message`, `permalink`, and `quote` use `source:{channel,ts,threadTs?}`. `quote` requires `invocationId`; a direct `excerpt` must occur in the fresh source, while `summary` is labelled separately. `search.quote` requires the current inbound action token and publishes approved source excerpts in Slack, returning only output receipts. Search response bodies remain excluded from subsequent agent history.

Action receipts distinguish `verified`, `partial`, `unknown`, and `failed`. A known posted or scheduled ID survives a later readback failure. Store and response limits can produce an explicit partial result. Scope presence, a successful write acknowledgement, and verified content are separate observations. HTTP workflow guards do not isolate a full-shell agent from credentials readable by the same OS account.

The manifest subscribes to `message.mpim` with optional `mpim:history`. These arrive as `message` events with `channel_type:mpim`; explicit bot mentions remain admissible, while group allowlists and mention-only rules still apply. Group DMs are not treated as one-to-one DMs. Existing installations require a reviewed Slack app update and reauthorization; editing the manifest grants nothing by itself. No group-creation permission is added.

Optional action permissions are separate from core messaging: `reactions:read`, `pins:read/write`, `bookmarks:read/write`, `canvases:write`, `lists:read/write`, and `search:read.public`. Request only the missing scopes for the operations being enabled. The runtime catalog reports actual observed grants; plan-dependent APIs can still refuse a request.

On startup, the prompt builder appends a versioned Slack tool anchor to a user-edited A1 without replacing the user's text. A2 updates use `PUT /api/prompt` with the full `content` string. Preserve unrelated A2 instructions. B and working-directory AGENTS must be inspected after application: a successful PUT response alone does not prove both files were written. Prompt generation retries a failed or missing output even when its desired content hash is unchanged.

Use authenticated `GET /api/prompt?withGenerated=1` to compare the current generated expectation with both disk outputs. Require `generated.bMatches` and `generated.agentsMatches` to be true and independently compare the reported expected hash/byte length with the files. Keep A2's exact round-trip check separate from generated output, which can transform path notation.


## Authorization and deployment boundary

This feature remains a draft pending the operator isolation work tracked in issue #646.
The assets are Slack credentials, source message content, and write authority. Authenticated
Slack ingress binds an actor, workspace, destination and request to a short-lived grant;
HTTP callers cannot supply their own actor or bot token. Current membership and disclosure
checks constrain supported tool calls. Source search output stays server-side and durable
publication holds prevent its contents from returning through history after uncertain sends.

These are HTTP workflow controls, not a sandbox. An agent with arbitrary shell or filesystem
access under the server's OS account can read the operator credential or other server secrets.
File mode 0600 and the separate operator header do not prevent that escalation. The threat
model therefore assumes trusted local operators and does not protect against a compromised
same-account agent. Do not deploy this as a security boundary for untrusted remote users
until operator credentials and execution are isolated from agent-readable storage.

Only fresh main print processes for Cursor, Claude, Codex and Grok receive tool grants.
Pooled native adapters, Codex App, Pi, other CLI transports and workers have no supported
tool authorization. The authenticated capability catalog remains readable without a turn
grant and reports `available:false` with `turn_authorization_unavailable`; its `authorization`
object explicitly reports `pooledNative:false`. Ordinary final replies use the server's
existing delivery path. Never fall back to operator mode from an unavailable agent tool.

Turn-created posts and schedules inherit the captured destination thread. A caller cannot
select another thread. Message edits/deletes, bookmark edits/removals and pin removals require
an active resource record for the same actor, bot, credential, channel and thread. Untracked
messages, including historical ordinary replies, require an explicit trusted operator.
This keeps historical administration available without granting every channel member control
over another requester's bot output. These operator controls retain the isolation blocker above.

Transport success is separate from rendered-content verification: `ok:true` from the ordinary
send transport means all posts succeeded, not that rich content was verified. Source quote
receipts use their own exact saved-block readback. Action receipts use their operation's
readback and retain `partial` or `unknown` when it cannot prove the requested result.

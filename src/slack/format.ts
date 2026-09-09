// ─── Slack Message Formatting ────────────────────────
// CommonMark (what agents emit) -> mrkdwn (what Slack renders).
// Conversion rules verified against docs.slack.dev/messaging/formatting-message-text
// The order of operations matters: bold must be handled before italic, because
// '**x**' contains '*x*' as a substring.

import { chunkFenceAware } from '../messaging/chunk.js';
import { redactOutboundText } from '../messaging/redact.js';
import { marked, type Tokens, type Token } from 'marked';

const CODE_FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]+`/g;
// Sentinel for stashed code spans. It must not occur in the input, so any
// literal occurrence is stripped first — otherwise text like "a\u00000\u0000b"
// would be mistaken for a stash reference and silently eat content.
const STASH_MARK = '\u0000';

/** Protect code spans from formatting conversion, convert, then restore. */
function withCodeProtected(text: string, convert: (s: string) => string): string {
    const stash: string[] = [];
    const stashed = text
        .replaceAll(STASH_MARK, '')
        .replace(CODE_FENCE, (m) => { stash.push(m); return `${STASH_MARK}${stash.length - 1}${STASH_MARK}`; })
        .replace(INLINE_CODE, (m) => { stash.push(m); return `${STASH_MARK}${stash.length - 1}${STASH_MARK}`; });
    const converted = convert(stashed);
    return converted.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)] ?? '');
}

export function toMrkdwn(text: string): string {
    if (!text) return '';
    return withCodeProtected(text, (s) => s
        // Links: [label](url) -> <url|label>. The label may contain balanced
        // brackets (common in agent output: "[see [1]](url)").
        .replace(/\[((?:[^\][]|\[[^\][]*\])+)\]\((https?:\/\/[^)\s]+)\)/g, '<$2|$1>')
        // Bold+italic first: ***x*** -> *_x_* (Slack has no combined marker).
        .replace(/\*\*\*([^*\n]+)\*\*\*/g, '*_$1_*')
        // Bold: **x** or __x__ -> *x*   (before italic)
        .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
        .replace(/__([^_\n]+)__/g, '*$1*')
        // Strikethrough: ~~x~~ -> ~x~
        .replace(/~~([^~\n]+)~~/g, '~$1~')
        // Headings: '## Title' -> '*Title*' (mrkdwn has no heading syntax)
        .replace(/^#{1,6}\s+(.+)$/gm, '*$1*'),
    ).replace(/```[a-zA-Z0-9_+-]+\n/g, '```\n'); // fence language tags are unsupported
}

/** Reserved for the ``` we may append/prepend when a split lands inside a fence. */
/**
 * Split for chat.postMessage.
 * Slack recommends staying under 4,000 chars and truncates above 40,000.
 * 3,900 leaves headroom for any prefix the caller adds.
 *
 * Delegates to the shared splitter. Slack never sees a fence language tag:
 * `toMrkdwn` strips it above, because mrkdwn does not render one. The shared
 * splitter preserves tags it finds but never invents one, so that contract
 * holds.
 *
 * Redaction happens here, as it does for Discord: every outbound Slack text
 * passes through this function, so there is one place to audit.
 */
/** Slack's practical per-message ceiling. Exported so the capability declaration is
 *  derived from the limit that actually chunks, not a second copy of the number. */
export const SLACK_MESSAGE_LIMIT = 3900;

export function chunkSlackMessage(text: string, limit = SLACK_MESSAGE_LIMIT): string[] {
    return chunkFenceAware(redactOutboundText(text), limit);
}

type SlackTextPayload = { text: string; blocks?: unknown };
const TABLE_ROWS_LIMIT = 100; // Includes the repeated header.
const TABLE_COLUMNS_LIMIT = 20;
// Below both Slack's 10,000 table-cell and 12,000 markdown character budgets.
const TABLE_MARKDOWN_LIMIT = 9000;

function tablePayloads(table: Tokens.Table): SlackTextPayload[] {
    if (table.header.length > TABLE_COLUMNS_LIMIT) {
        throw new RangeError('slack_table_too_wide: maximum 20 columns; split the table without dropping columns');
    }
    // Preserve original GFM, including escaped pipes, links and inline styling.
    // Rebuilding from cell.text would remove pipe escapes and alter cell boundaries.
    const [header, separator, ...rows] = table.raw.trimEnd().split('\n');
    const prefix = `${header}\n${separator}`;
    if (prefix.length > TABLE_MARKDOWN_LIMIT) {
        throw new RangeError('slack_table_header_too_long');
    }
    const payloads: SlackTextPayload[] = [];
    let markdown = prefix;
    let rowCount = 1;
    const flush = () => {
        payloads.push({ text: markdown, blocks: [{ type: 'markdown', text: markdown }] });
    };
    for (const row of rows) {
        if (prefix.length + row.length + 1 > TABLE_MARKDOWN_LIMIT) {
            throw new RangeError('slack_table_row_too_long: shorten the row or attach the full data');
        }
        if (rowCount === TABLE_ROWS_LIMIT || markdown.length + row.length + 1 > TABLE_MARKDOWN_LIMIT) {
            flush();
            markdown = prefix;
            rowCount = 1;
        }
        markdown += `\n${row}`;
        rowCount++;
    }
    flush();
    return payloads;
}

function remoteImage(href: string): boolean {
    try { const url = new URL(href); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}

/** Local image bytes are sent by the existing file relay. Keep their labels in
 * the body, without exposing filesystem paths or editing literal code samples. */
function localImageLabels(token: Token): string {
    if (token.type === 'image' && !remoteImage((token as Tokens.Image).href)) return (token as Tokens.Image).text || '이미지';
    if (token.type === 'code' || token.type === 'codespan') return token.raw;
    const children = token.type === 'list' ? (token as Tokens.List).items : 'tokens' in token ? token.tokens : undefined;
    if (!Array.isArray(children)) return token.raw;
    let result = ''; let cursor = 0;
    for (const child of children) {
        const start = token.raw.indexOf(child.raw, cursor);
        if (start < 0) continue;
        result += token.raw.slice(cursor, start) + localImageLabels(child);
        cursor = start + child.raw.length;
    }
    return result + token.raw.slice(cursor);
}

/** Keep Markdown semantics for all rich replies. Plain one-line replies retain
 * the lightweight text path. Packing is based on whole Markdown constructs,
 * with at most one table and bounded server-side expansion per message. */
export function buildSlackTextPayloads(text: string): SlackTextPayload[] {
    // A credential-bearing/private image URL cannot become a usable preview
    // after masking. Refuse before posting rather than silently turn a requested
    // image into broken Markdown and report a successful rich reply.
    marked.walkTokens(marked.lexer(text, { gfm: true }), token => {
        if (token.type === 'image') {
            const href = (token as Tokens.Image).href;
            if (remoteImage(href) && redactOutboundText(href) !== href) {
                throw new RangeError('slack_image_url_redacted: use a safe public image URL or a local file attachment');
            }
        }
    });
    const redacted = redactOutboundText(text);
    const safeText = marked.lexer(redacted, { gfm: true }).map(localImageLabels).join('');
    const tokens = marked.lexer(safeText, { gfm: true });
    let rich = false;
    marked.walkTokens(tokens, token => {
        if (['heading', 'list', 'blockquote', 'code', 'hr', 'table', 'strong', 'em', 'del', 'codespan', 'link', 'image'].includes(token.type)) rich = true;
    });
    if (!rich) return chunkSlackMessage(toMrkdwn(safeText)).map(chunk => ({ text: chunk }));
    type Atom = { markdown?: string; image?: { type: 'image'; image_url: string; alt_text: string }; table?: boolean };
    const atoms: Atom[] = [];
    for (const token of tokens) {
        if (token.type === 'space') continue;
        if (token.type === 'table') {
            atoms.push(...tablePayloads(token as Tokens.Table).map(p => ({ markdown: p.text, table: true })));
            continue;
        }
        if (token.type === 'heading' && (token as Tokens.Heading).tokens.some(t => !['text', 'escape'].includes(t.type))) {
            // Slack headers are plain_text: links/code inside a heading would
            // otherwise lose their semantics. Use a bold rich-text title.
            const title = (token as Tokens.Heading).text;
            const marker = !title.includes('**') ? '**' : !title.includes('__') ? '__' : '';
            atoms.push({ markdown: `${marker}${title}${marker}` });
            continue;
        }
        // Only standalone remote image Markdown becomes an image block. Local
        // images remain owned by the existing guarded file relay, never a URL.
        const inline = token.type === 'paragraph' ? (token as Tokens.Paragraph).tokens : [];
        if (inline.length === 1 && inline[0]?.type === 'image') {
            const image = inline[0] as Tokens.Image;
            if (remoteImage(image.href)) atoms.push({ image: { type: 'image', image_url: image.href, alt_text: image.text || '이미지' } });
            else if (image.text) atoms.push({ markdown: image.text });
            continue;
        }
        if (token.raw.length <= TABLE_MARKDOWN_LIMIT) {
            atoms.push({ markdown: token.raw.trimEnd() });
        } else if (token.type === 'list') {
            for (const item of (token as Tokens.List).items) {
                if (item.raw.length > TABLE_MARKDOWN_LIMIT) throw new RangeError('slack_list_item_too_long: split the item without dropping content');
                atoms.push({ markdown: item.raw.trimEnd() });
            }
        } else if (token.type === 'code' || token.type === 'paragraph' || token.type === 'text') {
            // Never cut a rich inline span/link in half. Very long plain prose
            // and fenced code use the existing code-point/fence-aware splitter.
            const nested = 'tokens' in token ? token.tokens : undefined;
            if (Array.isArray(nested) && nested.some(t => t.type !== 'text' && t.type !== 'br')) {
                throw new RangeError('slack_rich_span_too_long: split the paragraph at a formatting boundary');
            }
            atoms.push(...chunkFenceAware(token.raw, TABLE_MARKDOWN_LIMIT).map(markdown => ({ markdown })));
        } else throw new RangeError('slack_rich_block_too_long: split the block without dropping content');
    }
    const payloads: SlackTextPayload[] = [];
    let current: Atom[] = [];
    let chars = 0;
    let hasTable = false;
    const flush = () => {
        if (!current.length) return;
        const blocks: Array<Record<string, unknown>> = [];
        let markdown: string[] = [];
        const flushMarkdown = () => {
            if (markdown.length) blocks.push({ type: 'markdown', text: markdown.join('\n\n') });
            markdown = [];
        };
        for (const atom of current) {
            if (atom.image) { flushMarkdown(); blocks.push(atom.image); }
            else if (atom.markdown) markdown.push(atom.markdown);
        }
        flushMarkdown();
        const fallback = current.map(a => a.markdown ?? a.image?.alt_text ?? '').join('\n\n');
        payloads.push({ text: fallback, blocks });
        current = []; chars = 0; hasTable = false;
    };
    for (const atom of atoms) {
        const size = atom.markdown?.length ?? atom.image?.alt_text.length ?? 0;
        if (current.length >= 30 || chars + size + 2 > TABLE_MARKDOWN_LIMIT || (hasTable && atom.table)) flush();
        current.push(atom); chars += size + 2; hasTable ||= atom.table === true;
    }
    flush();
    return payloads;
}

import { isDeepStrictEqual } from 'node:util';
import { marked, type Token, type Tokens } from 'marked';
import { boundSlackContent, expectedTableContent, storedTableContent } from './table-content.js';

type Span = { kind: 'text' | 'link'; text: string; url?: string; style: number };
type Unit = { kind: 'section'; spans: Span[] } | { kind: 'table'; table: unknown } | { kind: 'divider' };
class UnsupportedContent extends Error {}
const unsupported = (): never => { throw new UnsupportedContent(); };
function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return unsupported();
    return value as Record<string, unknown>;
}
function fields(node: Record<string, unknown>, allowed: string[]): void {
    if (Object.keys(node).some(key => !allowed.includes(key))) unsupported();
}
function append(spans: Span[], span: Span): void {
    if (!span.text) return;
    const last = spans.at(-1);
    if (last && last.kind === span.kind && last.style === span.style && last.url === span.url) last.text += span.text;
    else spans.push(span);
}
function inline(tokens: Token[], depth = 0, style = 0, url?: string): Span[] {
    if (depth > 16) return unsupported();
    const spans: Span[] = [];
    for (const token of tokens) {
        if (['strong', 'em', 'del', 'link'].includes(token.type)) {
            const nested = token as Tokens.Strong | Tokens.Em | Tokens.Del | Tokens.Link;
            const bits = token.type === 'strong' ? 1 : token.type === 'em' ? 2 : token.type === 'del' ? 4 : 0;
            for (const span of inline(nested.tokens, depth + 1, style | bits, token.type === 'link' ? (token as Tokens.Link).href : url)) append(spans, span);
        } else if (['text', 'escape', 'codespan'].includes(token.type)) {
            if ('tokens' in token && token.tokens?.length) {
                for (const span of inline(token.tokens, depth + 1, style, url)) append(spans, span);
            } else append(spans, { kind: url === undefined ? 'text' : 'link', text: (token as Tokens.Text).text,
                style: style | (token.type === 'codespan' ? 8 : 0), ...(url === undefined ? {} : { url }) });
        } else unsupported();
    }
    return spans;
}
function nativeSection(section: unknown): Unit {
    // Reuse the strict table leaf contract for native text/link/style semantics.
    const tables = storedTableContent({ blocks: [{ type: 'table', rows: [[{ type: 'rich_text', elements: [section] }]] }] });
    const cell = tables[0]!.rows[0]![0]!;
    if (cell.kind !== 'text') return unsupported();
    return { kind: 'section', spans: cell.spans };
}
function canonical(blocks: unknown, expected: boolean): Unit[] {
    boundSlackContent(blocks);
    if (!Array.isArray(blocks)) return unsupported();
    const units: Unit[] = [];
    for (const value of blocks) {
        const block = record(value);
        if (expected && block['type'] === 'markdown') {
            fields(block, ['type', 'text', 'block_id']);
            if (typeof block['text'] !== 'string') unsupported();
            for (const token of marked.lexer(block['text'] as string, { gfm: true })) {
                if (token.type === 'space') continue;
                if (token.type === 'paragraph') units.push({ kind: 'section', spans: inline((token as Tokens.Paragraph).tokens) });
                else if (token.type === 'table') {
                    const tables = expectedTableContent([{ type: 'markdown', text: token.raw }]);
                    if (tables.length !== 1) unsupported();
                    units.push({ kind: 'table', table: tables[0] });
                } else if (token.type === 'hr') units.push({ kind: 'divider' });
                else unsupported();
            }
        } else if (block['type'] === 'table') {
            fields(block, ['type', 'rows', 'block_id']);
            const tables = storedTableContent({ blocks: [block] });
            units.push({ kind: 'table', table: tables[0] });
        } else if (block['type'] === 'rich_text') {
            fields(block, ['type', 'elements', 'block_id']);
            if (!Array.isArray(block['elements'])) unsupported();
            for (const section of block['elements'] as unknown[]) units.push(nativeSection(section));
        } else if (block['type'] === 'divider') {
            fields(block, ['type', 'block_id']); units.push({ kind: 'divider' });
        } else unsupported();
    }
    return units;
}

/** Exact supported body semantics, not feature presence or source accuracy.
 * Unsupported layouts stay partial even when their raw objects happen to match.
 * Empty-block messages have only their fallback text as an observable body.
 */
export function compareSlackMessageContent(expected: { text: string; blocks?: unknown }, stored: { text?: unknown; blocks?: unknown; attachments?: unknown; files?: unknown }): 'verified' | 'failed' | 'partial' {
    try {
        boundSlackContent(expected); boundSlackContent(stored);
        // Additional body surfaces are not covered by the block comparator.
        for (const key of ['attachments', 'files'] as const) {
            if (Object.hasOwn(stored, key) && (!Array.isArray(stored[key]) || stored[key].length !== 0)) return 'partial';
        }
        const left = canonical(expected.blocks ?? [], true);
        const right = canonical(stored.blocks ?? [], false);
        if (!left.length && !right.length) return typeof stored.text === 'string' && stored.text === expected.text ? 'verified' : 'failed';
        return isDeepStrictEqual(left, right) ? 'verified' : 'failed';
    } catch (error) {
        if (error instanceof UnsupportedContent || error instanceof RangeError) return 'partial';
        throw error;
    }
}

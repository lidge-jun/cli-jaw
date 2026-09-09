import { marked, type Token, type Tokens } from 'marked';

export type TableContentStatus = 'verified' | 'failed' | 'not_checked';
type Span = { kind: 'text' | 'link'; text: string; url?: string; style: number };
type Cell = { kind: 'text'; spans: Span[] } | { kind: 'number'; value: number; text: string };
export type CanonicalTable = { rows: Cell[][] };
const STYLE_KEYS = ['bold', 'italic', 'strike', 'code'] as const;
function invalid(reason: string): never { throw new RangeError(`slack_table_content:${reason}`); }
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('invalid_node');
    return value as Record<string, unknown>;
}

/** Bound the entire input before lexer/feature traversal, including cycles and URLs. */
export function boundSlackContent(value: unknown, maxNodes = 65536): void {
    let nodes = 0; let bytes = 0;
    const visit = (item: unknown, depth: number): void => {
        if (++nodes > maxNodes || depth > 16) invalid('readback_node_limit');
        if (typeof item === 'string') {
            bytes += Buffer.byteLength(item);
            if (bytes > 1048576) invalid('readback_byte_limit');
        } else if (item && typeof item === 'object') {
            if (Array.isArray(item)) {
                if (item.length > maxNodes - nodes) invalid('readback_node_limit');
                for (const child of item) visit(child, depth + 1);
            } else {
                for (const key in item) if (Object.hasOwn(item, key)) { visit(key, depth + 1); visit((item as Record<string, unknown>)[key], depth + 1); }
            }
        }
    };
    visit(value, 0);
}

class Budget {
    nodes = 0; characters = 0;
    visit(depth: number): void { if (++this.nodes > 16384 || depth > 16) invalid('table_node_limit'); }
    text(value: unknown, url = false): string {
        if (typeof value !== 'string') return invalid('invalid_text');
        this.characters += url ? Buffer.byteLength(value) : value.length;
        if (this.characters > 10000) invalid('table_content_limit');
        return value;
    }
}
function append(spans: Span[], span: Span): void {
    if (!span.text) return;
    const last = spans.at(-1);
    if (last && last.kind === span.kind && last.url === span.url && last.style === span.style) last.text += span.text;
    else spans.push(span);
}
function styleOf(value: unknown): number {
    if (value === undefined) return 0;
    const style = object(value); let bits = 0;
    for (const [key, flag] of Object.entries(style)) {
        const index = STYLE_KEYS.findIndex(k => k === key);
        if (index < 0 || typeof flag !== 'boolean') invalid('unsupported_style');
        if (flag) bits |= 1 << index;
    }
    return bits;
}
function fields(node: Record<string, unknown>, allowed: string[]): void {
    for (const key in node) if (Object.hasOwn(node, key) && !allowed.includes(key)) invalid('unsupported_field');
}
function nativeCell(value: unknown, budget: Budget): Cell {
    const cell = object(value); budget.visit(0);
    if (cell['type'] === 'raw_number') {
        fields(cell, ['type', 'value', 'text']);
        if (typeof cell['value'] !== 'number' || !Number.isFinite(cell['value'])) invalid('invalid_number');
        return { kind: 'number', value: cell['value'] as number, text: budget.text(cell['text']) };
    }
    if (cell['type'] === 'raw_text') fields(cell, ['type', 'text']);
    if (cell['type'] === 'raw_text') return { kind: 'text', spans: cell['text'] === '' ? [] : [{ kind: 'text', text: budget.text(cell['text']), style: 0 }] };
    if (cell['type'] !== 'rich_text') return invalid('unsupported_cell');
    fields(cell, ['type', 'elements', 'block_id']);
    const spans: Span[] = [];
    const walk = (value: unknown, depth: number): void => {
        budget.visit(depth); const node = object(value);
        if (node['type'] === 'rich_text_section') {
            fields(node, ['type', 'elements']);
            if (depth !== 1 || node['style'] !== undefined) invalid('unsupported_section');
            if (!Array.isArray(node['elements'])) invalid('invalid_elements');
            for (const child of node['elements'] as unknown[]) walk(child, depth + 1);
        } else if (node['type'] === 'text' || node['type'] === 'link') {
            const kind = node['type'];
            fields(node, kind === 'link' ? ['type', 'text', 'url', 'style'] : ['type', 'text', 'style']);
            const url = kind === 'link' ? budget.text(node['url'], true) : undefined;
            append(spans, { kind, text: budget.text(node['text']), style: styleOf(node['style']), ...(url !== undefined ? { url } : {}) });
        } else invalid('unsupported_element');
    };
    if (!Array.isArray(cell['elements'])) invalid('invalid_elements');
    if ((cell['elements'] as unknown[]).length > 1) invalid('unsupported_sections');
    for (const section of cell['elements'] as unknown[]) {
        if (object(section)['type'] !== 'rich_text_section') invalid('unsupported_section');
        walk(section, 1);
    }
    return { kind: 'text', spans };
}
function markdownCell(cell: Tokens.TableCell, budget: Budget): Cell {
    const spans: Span[] = [];
    const walk = (tokens: Token[], style: number, depth: number, url?: string): void => {
        for (const token of tokens) {
            budget.visit(depth);
            if (['strong', 'em', 'del', 'link'].includes(token.type)) {
                const nested = token as Tokens.Strong | Tokens.Em | Tokens.Del | Tokens.Link;
                const next = token.type === 'strong' ? style | 1 : token.type === 'em' ? style | 2 : token.type === 'del' ? style | 4 : style;
                walk(nested.tokens, next, depth + 1, token.type === 'link' ? budget.text((token as Tokens.Link).href, true) : url);
            } else if (['text', 'escape', 'codespan'].includes(token.type)) {
                if ('tokens' in token && token.tokens?.length) { walk(token.tokens, style, depth + 1, url); continue; }
                append(spans, { kind: url === undefined ? 'text' : 'link', text: budget.text((token as Tokens.Text).text), style: token.type === 'codespan' ? style | 8 : style, ...(url !== undefined ? { url } : {}) });
            } else invalid('unsupported_markdown');
        }
    };
    walk(cell.tokens, 0, 0);
    return { kind: 'text', spans };
}
function dimensions(rows: unknown[]): void {
    if (!rows.length || rows.length > 100) invalid('row_limit');
    const width = Array.isArray(rows[0]) ? rows[0].length : 0;
    if (!width || width > 20 || rows.some(r => !Array.isArray(r) || r.length !== width)) invalid('column_limit');
}
export function expectedTableContent(blocks: unknown): CanonicalTable[] {
    boundSlackContent(blocks);
    if (blocks === undefined) return [];
    if (!Array.isArray(blocks)) return invalid('invalid_blocks');
    const tables: CanonicalTable[] = [];
    for (const value of blocks) {
        const block = object(value);
        if (block['type'] === 'table') tables.push(nativeTable(block));
        if (block['type'] === 'markdown') {
            if (typeof block['text'] !== 'string') invalid('invalid_markdown');
            marked.walkTokens(marked.lexer(block['text'] as string, { gfm: true }), token => {
                if (token.type !== 'table') return;
                const table = token as Tokens.Table; const rows = [table.header, ...table.rows];
                dimensions(rows); const budget = new Budget();
                tables.push({ rows: rows.map(row => row.map(cell => markdownCell(cell, budget))) });
            });
        }
    }
    return tables;
}
function nativeTable(block: Record<string, unknown>): CanonicalTable {
    boundSlackContent(block, 16384);
    if (!Array.isArray(block['rows'])) return invalid('invalid_rows');
    const rows = block['rows']; dimensions(rows); const budget = new Budget();
    return { rows: rows.map(row => (row as unknown[]).map(cell => nativeCell(cell, budget))) };
}
export function storedTableContent(message: unknown): CanonicalTable[] {
    boundSlackContent(message); const root = object(message); const tables: CanonicalTable[] = [];
    const collect = (blocks: unknown): void => {
        if (blocks === undefined) return;
        if (!Array.isArray(blocks)) invalid('invalid_blocks');
        for (const value of blocks as unknown[]) { const block = object(value); if (block['type'] === 'table') tables.push(nativeTable(block)); }
    };
    collect(root['blocks']);
    if (root['attachments'] !== undefined) {
        if (!Array.isArray(root['attachments'])) invalid('invalid_attachments');
        for (const attachment of root['attachments'] as unknown[]) collect(object(attachment)['blocks']);
    }
    return tables;
}
export function compareTableContent(expected: CanonicalTable[], actual: CanonicalTable[]): { ok: boolean; verifiedTables: number; reason?: string } {
    if (expected.length !== actual.length) return { ok: false, verifiedTables: 0, reason: 'table_count_or_shape_mismatch' };
    let verifiedTables = 0;
    for (let t = 0; t < expected.length; t++) {
        const left = expected[t]!.rows; const right = actual[t]!.rows;
        if (left.length !== right.length || left.some((row, r) => row.length !== right[r]?.length)) return { ok: false, verifiedTables, reason: 'table_count_or_shape_mismatch' };
        for (let r = 0; r < left.length; r++) for (let c = 0; c < left[r]!.length; c++) {
            const a = left[r]![c]!; const b = right[r]![c]!;
            if ((a.kind === 'number' && b.kind === 'number' && !Object.is(a.value, b.value)) || JSON.stringify(a) !== JSON.stringify(b)) return { ok: false, verifiedTables, reason: `table_content_mismatch:${t}:${r}:${c}` };
        }
        verifiedTables++;
    }
    return { ok: true, verifiedTables };
}

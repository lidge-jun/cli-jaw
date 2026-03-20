import { getArgumentCompletionItems, getCompletionItems } from '../commands.js';

export interface AutocompleteState {
    open: boolean;
    stage: string;
    contextHeader: string;
    items: any[];
    selected: number;
    windowStart: number;
    visibleRows: number;
    renderedRows: number;
    maxRowsCommand: number;
    maxRowsArgument: number;
}

export interface ResolvedAutocompleteState {
    open: boolean;
    stage?: string;
    contextHeader?: string;
    items: any[];
    selected: number;
    visibleRows: number;
}

export interface ResolveAutocompleteOptions {
    draft: string | null;
    prevKey: string;
    maxPopupRows: number;
    maxRowsCommand: number;
    maxRowsArgument: number;
    getCommandItems?: (draft: string) => any[];
    getArgumentItems?: (commandName: string, partial: string, argv: string[]) => any[];
}

export interface RenderAutocompleteOptions {
    write: (chunk: string) => void;
    columns: number;
    dimCode: string;
    resetCode: string;
    clipTextToCols: (str: string, maxCols: number) => string;
}

export function createAutocompleteState(): AutocompleteState {
    return {
        open: false,
        stage: 'command',
        contextHeader: '',
        items: [],
        selected: 0,
        windowStart: 0,
        visibleRows: 0,
        renderedRows: 0,
        maxRowsCommand: 6,
        maxRowsArgument: 8,
    };
}

export function makeSelectionKey(item: any, stage: string): string {
    if (!item) return '';
    const base = item.command ? `${item.command}:${item.name}` : item.name;
    return `${stage}:${base}`;
}

export function popupTotalRows(state: { open: boolean; visibleRows: number; contextHeader?: string }): number {
    if (!state.open) return 0;
    return state.visibleRows + (state.contextHeader ? 1 : 0);
}

export function syncAutocompleteWindow(state: AutocompleteState): void {
    if (!state.items.length || state.visibleRows <= 0) {
        state.windowStart = 0;
        return;
    }
    state.selected = Math.max(0, Math.min(state.selected, state.items.length - 1));
    const maxStart = Math.max(0, state.items.length - state.visibleRows);
    state.windowStart = Math.max(0, Math.min(state.windowStart, maxStart));
    if (state.selected < state.windowStart) state.windowStart = state.selected;
    if (state.selected >= state.windowStart + state.visibleRows) {
        state.windowStart = state.selected - state.visibleRows + 1;
    }
}

export function resolveAutocompleteState(options: ResolveAutocompleteOptions): ResolvedAutocompleteState {
    const {
        draft,
        prevKey,
        maxPopupRows,
        maxRowsCommand,
        maxRowsArgument,
        getCommandItems = (value) => getCompletionItems(value, 'cli'),
        getArgumentItems = (commandName, partial, argv) => getArgumentCompletionItems(commandName, partial, 'cli', argv, {}),
    } = options;

    if (!draft || !draft.startsWith('/')) {
        return { open: false, items: [], selected: 0, visibleRows: 0 };
    }

    const body = draft.slice(1);
    const firstSpace = body.indexOf(' ');
    let stage = 'command';
    let contextHeader = '';
    let items: any[] = [];

    if (firstSpace === -1) {
        items = getCommandItems(draft);
    } else {
        const commandName = body.slice(0, firstSpace).trim().toLowerCase();
        if (!commandName) return { open: false, items: [], selected: 0, visibleRows: 0 };

        const rest = body.slice(firstSpace + 1);
        const endsWithSpace = /\s$/.test(rest);
        const tokens = rest.trim() ? rest.trim().split(/\s+/) : [];
        const partial = endsWithSpace ? '' : (tokens[tokens.length - 1] || '');
        const argv = endsWithSpace ? tokens : tokens.slice(0, -1);

        items = getArgumentItems(commandName, partial, argv);
        if (items.length) {
            stage = 'argument';
            contextHeader = `${commandName} ▸ ${items[0]?.commandDesc || '인자 선택'}`;
        }
    }

    if (!items.length) {
        return { open: false, items: [], selected: 0, visibleRows: 0 };
    }

    const selected = (() => {
        if (!prevKey) return 0;
        const idx = items.findIndex(item => makeSelectionKey(item, stage) === prevKey);
        return idx >= 0 ? idx : 0;
    })();

    const headerRows = contextHeader ? 1 : 0;
    const maxItemRows = Math.max(0, maxPopupRows - headerRows);
    const stageCap = stage === 'argument' ? maxRowsArgument : maxRowsCommand;
    const visibleRows = Math.min(stageCap, items.length, maxItemRows);

    if (visibleRows <= 0) {
        return { open: false, items: [], selected: 0, visibleRows: 0 };
    }

    return { open: true, stage, contextHeader, items, selected, visibleRows };
}

export function resetAutocompleteState(state: AutocompleteState): void {
    state.open = false;
    state.stage = 'command';
    state.contextHeader = '';
    state.items = [];
    state.selected = 0;
    state.windowStart = 0;
    state.visibleRows = 0;
}

export function applyResolvedAutocompleteState(state: AutocompleteState, next: ResolvedAutocompleteState): void {
    if (!next.open) {
        resetAutocompleteState(state);
        return;
    }
    state.open = true;
    state.stage = next.stage ?? 'command';
    state.contextHeader = next.contextHeader || '';
    state.items = next.items;
    state.selected = next.selected;
    state.visibleRows = next.visibleRows;
    syncAutocompleteWindow(state);
}

export function clearAutocomplete(state: AutocompleteState, write: (chunk: string) => void): void {
    if (state.renderedRows <= 0) return;
    write('\x1b[s');
    for (let row = 1; row <= state.renderedRows; row++) {
        write(`\x1b[${row}B\r\x1b[2K\x1b[${row}A`);
    }
    write('\x1b[u');
    state.renderedRows = 0;
}

export function closeAutocomplete(state: AutocompleteState, write: (chunk: string) => void): void {
    clearAutocomplete(state, write);
    resetAutocompleteState(state);
}

export function formatAutocompleteLine(
    item: any,
    selected: boolean,
    stage: string,
    options: Pick<RenderAutocompleteOptions, 'columns' | 'dimCode' | 'resetCode' | 'clipTextToCols'>,
): string {
    const value = stage === 'argument' ? item.name : `/${item.name}`;
    const valueCol = stage === 'argument' ? 24 : 14;
    const valueText = value.length >= valueCol ? value.slice(0, valueCol) : value.padEnd(valueCol, ' ');
    const desc = item.desc || '';
    const raw = `  ${valueText}  ${desc}`;
    const line = options.clipTextToCols(raw, options.columns - 2);
    return selected ? `\x1b[7m${line}${options.resetCode}` : `${options.dimCode}${line}${options.resetCode}`;
}

export function renderAutocomplete(state: AutocompleteState, options: RenderAutocompleteOptions): void {
    clearAutocomplete(state, options.write);
    if (!state.open || state.items.length === 0 || state.visibleRows <= 0) return;

    syncAutocompleteWindow(state);
    const start = state.windowStart;
    const end = Math.min(state.items.length, start + state.visibleRows);
    const headerRows = state.contextHeader ? 1 : 0;
    options.write('\x1b[s');

    if (headerRows) {
        options.write('\x1b[1B\r\x1b[2K');
        const header = options.clipTextToCols(`  ${state.contextHeader}`, options.columns - 2);
        options.write(`${options.dimCode}${header}${options.resetCode}`);
        options.write('\x1b[1A');
    }

    for (let i = start; i < end; i++) {
        const row = (i - start) + 1 + headerRows;
        options.write(`\x1b[${row}B\r\x1b[2K`);
        options.write(formatAutocompleteLine(state.items[i], i === state.selected, state.stage, options));
        options.write(`\x1b[${row}A`);
    }

    state.renderedRows = headerRows + (end - start);
    options.write('\x1b[u');
}

// ─── Help overlay ────────────────────────────

export interface HelpEntry {
    key: string;
    desc: string;
}

const HELP_ENTRIES: HelpEntry[] = [
    { key: 'Enter',        desc: 'submit message' },
    { key: 'Option+Enter', desc: 'newline' },
    { key: 'Tab',          desc: 'autocomplete accept' },
    { key: 'Ctrl+C',       desc: 'stop agent / exit' },
    { key: 'Ctrl+U',       desc: 'clear line' },
    { key: 'Ctrl+K',       desc: 'command palette' },
    { key: '?',            desc: 'this help' },
    { key: '/',            desc: 'slash commands (type to filter)' },
    { key: 'Up/Down',      desc: 'autocomplete navigate' },
    { key: 'Esc',          desc: 'close popup / stop' },
];

export function renderHelpOverlay(
    write: (chunk: string) => void,
    cols: number,
    rows: number,
    dimCode: string,
    resetCode: string,
    extraCommands?: { name: string; desc: string }[],
): number {
    const keyCol = 16;
    const lines: string[] = [];

    for (const e of HELP_ENTRIES) {
        lines.push(`  ${e.key.padEnd(keyCol)}${e.desc}`);
    }

    if (extraCommands?.length) {
        lines.push('');
        lines.push('  Slash commands:');
        for (const cmd of extraCommands.slice(0, 8)) {
            lines.push(`  ${('/' + cmd.name).padEnd(keyCol)}${cmd.desc || ''}`);
        }
        if (extraCommands.length > 8) {
            lines.push(`  ${dimCode}... +${extraCommands.length - 8} more (use Ctrl+K)${resetCode}`);
        }
    }

    lines.push('');
    lines.push(`  ${dimCode}Press Escape to close${resetCode}`);

    const boxWidth = Math.min(52, cols - 4);
    const boxHeight = Math.min(lines.length + 2, rows - 4);
    const startRow = Math.max(1, Math.floor((rows - boxHeight) / 2));
    const startCol = Math.max(1, Math.floor((cols - boxWidth) / 2));

    const hLine = '─'.repeat(boxWidth - 2);

    write('\x1b[?25l');
    write(`\x1b[${startRow};${startCol}H┌─ Help ${hLine.slice(7)}┐`);

    const contentRows = boxHeight - 2;
    for (let i = 0; i < contentRows; i++) {
        const r = startRow + 1 + i;
        const text = lines[i] ?? '';
        const padded = text.length < boxWidth - 2
            ? text + ' '.repeat(boxWidth - 2 - text.length)
            : text.slice(0, boxWidth - 2);
        write(`\x1b[${r};${startCol}H│${padded}│`);
    }

    write(`\x1b[${startRow + boxHeight - 1};${startCol}H└${hLine}┘`);
    write('\x1b[?25h');

    return boxHeight;
}

export function clearOverlayBox(
    write: (chunk: string) => void,
    cols: number,
    rows: number,
    boxHeight: number,
): void {
    const boxWidth = Math.min(52, cols - 4);
    const startRow = Math.max(1, Math.floor((rows - boxHeight) / 2));
    const startCol = Math.max(1, Math.floor((cols - boxWidth) / 2));
    const blank = ' '.repeat(boxWidth);
    for (let i = 0; i < boxHeight; i++) {
        write(`\x1b[${startRow + i};${startCol}H${blank}`);
    }
}

// ─── Command palette ─────────────────────────

export interface PaletteRenderOptions {
    write: (chunk: string) => void;
    cols: number;
    rows: number;
    dimCode: string;
    resetCode: string;
    filter: string;
    items: { name: string; desc: string }[];
    selected: number;
}

export function renderCommandPalette(opts: PaletteRenderOptions): number {
    const { write, cols, rows, dimCode, resetCode, filter, items, selected } = opts;

    const boxWidth = Math.min(52, cols - 4);
    const maxItems = Math.min(items.length, rows - 8, 12);
    const boxHeight = maxItems + 5;
    const startRow = Math.max(1, Math.floor((rows - boxHeight) / 2));
    const startCol = Math.max(1, Math.floor((cols - boxWidth) / 2));

    const hLine = '─'.repeat(boxWidth - 2);
    const innerW = boxWidth - 2;

    write('\x1b[?25l');

    write(`\x1b[${startRow};${startCol}H┌─ Commands ${hLine.slice(11)}┐`);

    const filterText = `  > ${filter}`;
    const filterPad = filterText.length < innerW
        ? filterText + ' '.repeat(innerW - filterText.length)
        : filterText.slice(0, innerW);
    write(`\x1b[${startRow + 1};${startCol}H│${filterPad}│`);

    write(`\x1b[${startRow + 2};${startCol}H│${' '.repeat(innerW)}│`);

    for (let i = 0; i < maxItems; i++) {
        const r = startRow + 3 + i;
        const item = items[i];
        if (!item) {
            write(`\x1b[${r};${startCol}H│${' '.repeat(innerW)}│`);
            continue;
        }
        const nameStr = ('  /' + item.name).padEnd(16);
        const descStr = item.desc || '';
        let line = `${nameStr}${descStr}`;
        if (line.length > innerW) line = line.slice(0, innerW);
        else line = line + ' '.repeat(innerW - line.length);

        if (i === selected) {
            write(`\x1b[${r};${startCol}H│\x1b[7m${line}${resetCode}│`);
        } else {
            write(`\x1b[${r};${startCol}H│${dimCode}${line}${resetCode}│`);
        }
    }

    const footer = ' ↑↓ navigate  Enter select  Esc close';
    const footerPad = footer.length < innerW
        ? footer + ' '.repeat(innerW - footer.length)
        : footer.slice(0, innerW);
    write(`\x1b[${startRow + 3 + maxItems};${startCol}H│${dimCode}${footerPad}${resetCode}│`);

    write(`\x1b[${startRow + boxHeight - 1};${startCol}H└${hLine}┘`);

    write('\x1b[?25h');
    return boxHeight;
}

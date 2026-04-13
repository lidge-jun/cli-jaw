/**
 * TUI rendering: prompt, block separators, footer.
 */
import { getComposerDisplayText } from '../../../src/cli/tui/composer.js';
import { closeAutocomplete } from '../../../src/cli/tui/overlay.js';
import { visualWidth } from '../../../src/cli/tui/renderers.js';
import { resolveShellLayout, setupScrollRegion } from '../../../src/cli/tui/shell.js';
import { c, hrLine, getRows, type TuiContext } from './types.js';

export function rebuildFooter(ctx: TuiContext): void {
    ctx.footer = `  ${c.dim}${ctx.accent}${ctx.label}${c.reset}${c.dim}  |  /quit  |  /clear${c.reset}`;
    ctx.promptPrefix = `  ${ctx.accent}\u276F${c.reset} `;
    setupScrollRegion(
        ctx.footer,
        `  ${c.dim}${hrLine()}${c.reset}`,
        resolveShellLayout(process.stdout.columns || 80, getRows(), ctx.store.panes),
    );
}

export function renderBlockSeparator(): void {
    process.stdout.write('\n');
    console.log(`  ${c.dim}${hrLine()}${c.reset}`);
}

export function renderAssistantTurnStart(): void {
    process.stdout.write('\n  ');
}

export function showPrompt(ctx: TuiContext): void {
    closeAutocomplete(ctx.store.autocomplete, (chunk) => process.stdout.write(chunk));
    ctx.prevLineCount = 1;
    process.stdout.write(ctx.promptPrefix);
}

export function openPromptBlock(ctx: TuiContext): void {
    renderBlockSeparator();
    showPrompt(ctx);
}

export function reopenPromptLine(ctx: TuiContext): void {
    process.stdout.write('\n');
    showPrompt(ctx);
}

export function redrawPromptLine(ctx: TuiContext): void {
    const cols = process.stdout.columns || 80;
    if (ctx.prevLineCount > 1) {
        process.stdout.write(`\x1b[${ctx.prevLineCount - 1}A`);
    }
    for (let i = 0; i < ctx.prevLineCount; i++) {
        process.stdout.write('\r\x1b[2K');
        if (i < ctx.prevLineCount - 1) process.stdout.write('\x1b[1B');
    }
    if (ctx.prevLineCount > 1) {
        process.stdout.write(`\x1b[${ctx.prevLineCount - 1}A`);
    }
    process.stdout.write('\r');

    const lines = getComposerDisplayText(ctx.store.composer).split('\n');
    const contPrefix = `  ${c.dim}\u00B7 ${c.reset}`;
    let totalRows = 0;
    for (let i = 0; i < lines.length; i++) {
        const prefix = i === 0 ? ctx.promptPrefix : contPrefix;
        const rendered = prefix + lines[i]!;
        process.stdout.write(rendered);
        if (i < lines.length - 1) process.stdout.write('\n');
        totalRows += Math.max(1, Math.ceil(visualWidth(rendered) / cols));
    }
    ctx.prevLineCount = totalRows;
}

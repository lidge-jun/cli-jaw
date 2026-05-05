/**
 * TUI overlays: dismiss, autocomplete, resize, slash commands.
 */
import {
    clearOverlayBox, renderHelpOverlay, renderCommandPalette, renderChoiceSelector,
    clearAutocomplete, closeAutocomplete, resolveAutocompleteState,
    applyResolvedAutocompleteState, renderAutocomplete, popupTotalRows,
    makeSelectionKey, filterSelectorItems,
} from '../../../src/cli/tui/overlay.js';
import {
    getPlainCommandDraft, clearComposer, appendTextToComposer, setBracketedPaste,
} from '../../../src/cli/tui/composer.js';
import { clipTextToCols } from '../../../src/cli/tui/renderers.js';
import {
    resolveShellLayout, setupScrollRegion, cleanupScrollRegion, ensureSpaceBelow,
} from '../../../src/cli/tui/shell.js';
import { executeCommand, getCompletionItems, getArgumentCompletionItems } from '../../../src/cli/commands.js';
import type { ArgumentCompletionItem } from '../../../src/cli/commands.js';
import type { ParsedSlashCommand } from '../../../src/cli/types.js';
import { getIdeCli } from '../../../src/ide/diff.js';
import { c, hrLine, getRows, renderCommandText, type TuiContext } from './types.js';
import { showPrompt, redrawPromptLine, openPromptBlock, rebuildFooter } from './renderer.js';
import { refreshInfo, makeCliCommandCtx } from './api.js';

export function dismissOverlay(ctx: TuiContext): void {
    const ov = ctx.store.overlay;
    if (!ov.helpOpen && !ov.paletteOpen && !ov.selector.open) return;
    if (ctx.overlayBoxHeight > 0) {
        clearOverlayBox(
            (chunk) => process.stdout.write(chunk),
            process.stdout.columns || 80,
            getRows(),
            ctx.overlayBoxHeight,
        );
        ctx.overlayBoxHeight = 0;
    }
    ov.helpOpen = false;
    ov.paletteOpen = false;
    ov.paletteFilter = '';
    ov.paletteSelected = 0;
    ov.paletteItems = [];
    ov.selector.open = false;
    ov.selector.commandName = '';
    ov.selector.filter = '';
    ov.selector.selected = 0;
    ov.selector.allItems = [];
    ov.selector.filteredItems = [];
    setupScrollRegion(
        ctx.footer,
        `  ${c.dim}${hrLine()}${c.reset}`,
        resolveShellLayout(process.stdout.columns || 80, getRows(), ctx.store.panes),
    );
    showPrompt(ctx);
    redrawPromptLine(ctx);
}

export function getMaxPopupRows(): number {
    return Math.max(0, getRows() - 3);
}

export function redrawInputWithAutocomplete(ctx: TuiContext): void {
    const ac = ctx.store.autocomplete;
    const prevItem = ac.items[ac.selected];
    const prevKey = makeSelectionKey(prevItem, ac.stage);
    const next = resolveAutocompleteState({
        draft: getPlainCommandDraft(ctx.store.composer),
        prevKey,
        maxPopupRows: getMaxPopupRows(),
        maxRowsCommand: ac.maxRowsCommand,
        maxRowsArgument: ac.maxRowsArgument,
    });
    clearAutocomplete(ac, (chunk) => process.stdout.write(chunk));
    if (next.open) ensureSpaceBelow(popupTotalRows(next));
    redrawPromptLine(ctx);
    applyResolvedAutocompleteState(ac, next);
    renderAutocomplete(ac, {
        write: (chunk) => process.stdout.write(chunk),
        columns: process.stdout.columns || 80,
        dimCode: c.dim,
        resetCode: c.reset,
        clipTextToCols,
    });
}

export function handleResize(ctx: TuiContext): void {
    setupScrollRegion(
        ctx.footer,
        `  ${c.dim}${hrLine()}${c.reset}`,
        resolveShellLayout(process.stdout.columns || 80, getRows(), ctx.store.panes),
    );
    if (!ctx.inputActive || ctx.commandRunning) return;
    redrawInputWithAutocomplete(ctx);
}

// ─── Slash command execution ─────────────────
export async function runSlashCommand(ctx: TuiContext, parsed: ParsedSlashCommand): Promise<void> {
    if (!parsed || parsed.type !== 'known') return;
    const ov = ctx.store.overlay;
    const ac = ctx.store.autocomplete;
    const composer = ctx.store.composer;
    const panes = ctx.store.panes;

    // Overlay intercepts
    if (parsed.name === 'help') {
        ov.helpOpen = true;
        const cmds = getCompletionItems('/', 'cli');
        ctx.overlayBoxHeight = renderHelpOverlay(
            (chunk) => process.stdout.write(chunk),
            process.stdout.columns || 80,
            getRows(),
            c.dim, c.reset,
            cmds,
        );
        ctx.commandRunning = false;
        ctx.inputActive = true;
        return;
    }

    if (parsed.name === 'model' && !parsed.args.length) {
        const argItems = getArgumentCompletionItems('model', '', 'cli', [], makeCliCommandCtx(ctx));
        const sel = ov.selector;
        sel.open = true;
        sel.commandName = 'model';
        sel.title = 'Model';
        sel.subtitle = `${ctx.info.cli}: ${ctx.info.model || 'default'}`;
        sel.filter = '';
        sel.selected = 0;
        sel.allItems = argItems.map((a: ArgumentCompletionItem) => ({
            value: a.name, label: a.desc || '', current: a.name === ctx.info.model,
        }));
        sel.filteredItems = sel.allItems;
        const curIdx = sel.filteredItems.findIndex(i => i.current);
        if (curIdx >= 0) sel.selected = curIdx;
        ctx.overlayBoxHeight = renderChoiceSelector({
            write: (chunk) => process.stdout.write(chunk),
            cols: process.stdout.columns || 80,
            rows: getRows(),
            dimCode: c.dim, resetCode: c.reset,
            title: sel.title, subtitle: sel.subtitle,
            filter: sel.filter, items: sel.filteredItems, selected: sel.selected,
        });
        ctx.commandRunning = false;
        ctx.inputActive = true;
        return;
    }

    if (parsed.name === 'cli' && !parsed.args.length) {
        const argItems = getArgumentCompletionItems('cli', '', 'cli', [], makeCliCommandCtx(ctx));
        const sel = ov.selector;
        sel.open = true;
        sel.commandName = 'cli';
        sel.title = 'CLI Engine';
        sel.subtitle = `current: ${ctx.info.cli}`;
        sel.filter = '';
        sel.selected = 0;
        sel.allItems = argItems.map((a: ArgumentCompletionItem) => ({
            value: a.name, label: a.desc || '', current: a.name === ctx.info.cli,
        }));
        sel.filteredItems = sel.allItems;
        const curIdx = sel.filteredItems.findIndex(i => i.current);
        if (curIdx >= 0) sel.selected = curIdx;
        ctx.overlayBoxHeight = renderChoiceSelector({
            write: (chunk) => process.stdout.write(chunk),
            cols: process.stdout.columns || 80,
            rows: getRows(),
            dimCode: c.dim, resetCode: c.reset,
            title: sel.title, subtitle: sel.subtitle,
            filter: sel.filter, items: sel.filteredItems, selected: sel.selected,
        });
        ctx.commandRunning = false;
        ctx.inputActive = true;
        return;
    }

    if (parsed.name === 'commands') {
        ov.paletteOpen = true;
        ov.paletteFilter = '';
        ov.paletteSelected = 0;
        ov.paletteItems = getCompletionItems('/', 'cli');
        ctx.overlayBoxHeight = renderCommandPalette({
            write: (chunk) => process.stdout.write(chunk),
            cols: process.stdout.columns || 80,
            rows: getRows(),
            dimCode: c.dim, resetCode: c.reset,
            filter: ov.paletteFilter, items: ov.paletteItems, selected: ov.paletteSelected,
        });
        ctx.commandRunning = false;
        ctx.inputActive = true;
        return;
    }

    let exiting = false;
    try {
        const result = await executeCommand(parsed, makeCliCommandCtx(ctx));
        if (result?.code === 'clear_screen') {
            console.clear();
            setupScrollRegion(ctx.footer, `  ${c.dim}${hrLine()}${c.reset}`, resolveShellLayout(process.stdout.columns || 80, getRows(), panes));
        }
        if (result?.text) console.log(`  ${renderCommandText(result.text)}`);
        if (result?.code === 'ide_toggle') { ctx.ideEnabled = !ctx.ideEnabled; }
        if (result?.code === 'ide_on') { ctx.ideEnabled = true; }
        if (result?.code === 'ide_off') { ctx.ideEnabled = false; }
        if (result?.code && ['ide_toggle', 'ide_on', 'ide_off'].includes(result.code)) {
            console.log(`  ${ctx.ideEnabled ? c.green + '\u2713' : c.yellow + '\u2717'}${c.reset} IDE diff: ${ctx.ideEnabled ? 'ON' : 'OFF'}${ctx.isGit ? '' : ` ${c.dim}(non-git)${c.reset}`}`);
        }
        if (result?.code === 'ide_pop_toggle') {
            ctx.idePopEnabled = !ctx.idePopEnabled;
            const ideName = ctx.detectedIde ? getIdeCli(ctx.detectedIde) : null;
            console.log(`  ${ctx.idePopEnabled ? c.green + '\u2713' : c.yellow + '\u2717'}${c.reset} IDE popup: ${ctx.idePopEnabled ? 'ON' : 'OFF'}${ideName ? ` (${ideName})` : ` ${c.dim}(IDE \uBBF8\uAC10\uC9C0)${c.reset}`}`);
        }
        if (result?.ok && (parsed.name === 'model' || parsed.name === 'cli') && parsed.args.length > 0) {
            await refreshInfo(ctx);
            rebuildFooter(ctx);
        }
        if (result?.code === 'exit') {
            exiting = true;
            cleanupScrollRegion(resolveShellLayout(process.stdout.columns || 80, getRows(), panes));
            console.log(`  ${c.dim}Bye! \uD83E\uDD9E${c.reset}\n`);
            setBracketedPaste(false);
            ctx.ws.close();
            process.stdin.setRawMode(false);
            process.exit(0);
        }
    } catch (err) {
        console.log(`  ${c.red}${(err as Error).message}${c.reset}`);
    } finally {
        if (!exiting) {
            ctx.commandRunning = false;
            ctx.inputActive = true;
            closeAutocomplete(ac, (chunk) => process.stdout.write(chunk));
            openPromptBlock(ctx);
        }
    }
}

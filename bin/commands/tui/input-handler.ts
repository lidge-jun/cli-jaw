/**
 * TUI keyboard input handling: key dispatch, autocomplete nav, ESC logic.
 */
import {
    appendNewlineToComposer, appendTextToComposer, backspaceComposer,
    clearComposer, flattenComposerForSubmit, getComposerDisplayText,
    getPlainCommandDraft, getTrailingTextSegment, setBracketedPaste,
} from '../../../src/cli/tui/composer.js';
import { classifyKeyAction } from '../../../src/cli/tui/keymap.js';
import {
    closeAutocomplete, renderAutocomplete,
    renderHelpOverlay, renderCommandPalette, renderChoiceSelector,
    filterSelectorItems,
} from '../../../src/cli/tui/overlay.js';
import { clipTextToCols } from '../../../src/cli/tui/renderers.js';
import { cleanupScrollRegion, resolveShellLayout } from '../../../src/cli/tui/shell.js';
import { parseCommand } from '../../../src/cli/commands.js';
import { getCompletionItems } from '../../../src/cli/commands.js';
import { appendUserItem } from '../../../src/cli/tui/transcript.js';
import { captureFileSet } from '../../../src/ide/diff.js';
import fs from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { c, getRows, ESC_WAIT_MS, type TuiContext } from './types.js';
import { openPromptBlock, reopenPromptLine, redrawPromptLine, renderBlockSeparator } from './renderer.js';
import { dismissOverlay, redrawInputWithAutocomplete, runSlashCommand } from './overlays.js';

export function flushPendingEscape(ctx: TuiContext): void {
    ctx.escPending = false;
    ctx.escTimer = null;
    const ov = ctx.store.overlay;
    if (ov.helpOpen || ov.paletteOpen || ov.selector.open) {
        dismissOverlay(ctx);
        return;
    }
    const ac = ctx.store.autocomplete;
    if (ac.open) {
        closeAutocomplete(ac, (chunk) => process.stdout.write(chunk));
        redrawPromptLine(ctx);
        return;
    }
    if (!ctx.inputActive) {
        if (ctx.commandRunning) return;
        ctx.ws.send(JSON.stringify({ type: 'stop' }));
        console.log(`\n  ${c.yellow}\u25A0 stopped${c.reset}`);
        ctx.inputActive = true;
        openPromptBlock(ctx);
    }
}

export function handleKeyInput(ctx: TuiContext, rawKey: string): void {
    let key = rawKey;
    if (ctx.escPending) {
        if (ctx.escTimer) clearTimeout(ctx.escTimer);
        ctx.escTimer = null;
        ctx.escPending = false;
        if (!key.startsWith('\x1b')) key = `\x1b${key}`;
    }

    const action = classifyKeyAction(key);
    if (action === 'escape-alone') {
        ctx.escPending = true;
        ctx.escTimer = setTimeout(() => flushPendingEscape(ctx), ESC_WAIT_MS);
        return;
    }

    const ov = ctx.store.overlay;
    const ac = ctx.store.autocomplete;
    const composer = ctx.store.composer;
    const panes = ctx.store.panes;

    // Option+Enter → insert newline
    if (action === 'option-enter') {
        if (ctx.commandRunning) return;
        if (!ctx.inputActive) {
            ctx.inputActive = true;
            openPromptBlock(ctx);
        }
        appendNewlineToComposer(composer);
        redrawInputWithAutocomplete(ctx);
        return;
    }

    // Help overlay: ? when input is empty
    if (action === 'printable' && key === '?' && !ac.open && !ov.paletteOpen) {
        const draft = getPlainCommandDraft(composer);
        if (draft === '' || draft === null) {
            if (ov.helpOpen) {
                dismissOverlay(ctx);
                return;
            }
            ov.helpOpen = true;
            closeAutocomplete(ac, (chunk) => process.stdout.write(chunk));
            const cmds = getCompletionItems('/', 'cli');
            ctx.overlayBoxHeight = renderHelpOverlay(
                (chunk) => process.stdout.write(chunk),
                process.stdout.columns || 80,
                getRows(),
                c.dim, c.reset,
                cmds,
            );
            return;
        }
    }

    // Dismiss help on any key that isn't ?
    if (ov.helpOpen) {
        dismissOverlay(ctx);
    }

    // Command palette: Ctrl+K
    if (action === 'ctrl-k' && !ov.helpOpen) {
        if (ov.paletteOpen) {
            dismissOverlay(ctx);
            return;
        }
        ov.paletteOpen = true;
        ov.paletteFilter = '';
        ov.paletteSelected = 0;
        ov.paletteItems = getCompletionItems('/', 'cli');
        closeAutocomplete(ac, (chunk) => process.stdout.write(chunk));
        ctx.overlayBoxHeight = renderCommandPalette({
            write: (chunk) => process.stdout.write(chunk),
            cols: process.stdout.columns || 80,
            rows: getRows(),
            dimCode: c.dim, resetCode: c.reset,
            filter: ov.paletteFilter, items: ov.paletteItems, selected: ov.paletteSelected,
        });
        return;
    }

    // Palette input handling
    if (ov.paletteOpen) {
        if (action === 'arrow-up') {
            ov.paletteSelected = Math.max(0, ov.paletteSelected - 1);
        } else if (action === 'arrow-down') {
            ov.paletteSelected = Math.min(ov.paletteItems.length - 1, ov.paletteSelected + 1);
        } else if (action === 'enter') {
            const picked = ov.paletteItems[ov.paletteSelected];
            dismissOverlay(ctx);
            if (picked) {
                clearComposer(composer);
                appendTextToComposer(composer, `/${picked.name}`);
                handleKeyInput(ctx, '\r');
            }
            return;
        } else if (action === 'backspace') {
            ov.paletteFilter = ov.paletteFilter.slice(0, -1);
            ov.paletteItems = getCompletionItems('/' + ov.paletteFilter, 'cli');
            ov.paletteSelected = Math.min(ov.paletteSelected, Math.max(0, ov.paletteItems.length - 1));
        } else if (action === 'printable') {
            ov.paletteFilter += key;
            ov.paletteItems = getCompletionItems('/' + ov.paletteFilter, 'cli');
            ov.paletteSelected = Math.min(ov.paletteSelected, Math.max(0, ov.paletteItems.length - 1));
        } else {
            return;
        }
        ctx.overlayBoxHeight = renderCommandPalette({
            write: (chunk) => process.stdout.write(chunk),
            cols: process.stdout.columns || 80,
            rows: getRows(),
            dimCode: c.dim, resetCode: c.reset,
            filter: ov.paletteFilter, items: ov.paletteItems, selected: ov.paletteSelected,
        });
        return;
    }

    // Choice selector input handling
    if (ov.selector.open) {
        const sel = ov.selector;
        const itemCount = sel.filteredItems.length;
        if (action === 'arrow-up') {
            if (itemCount > 0) sel.selected = Math.max(0, sel.selected - 1);
        } else if (action === 'arrow-down') {
            if (itemCount > 0) sel.selected = Math.min(itemCount - 1, sel.selected + 1);
        } else if (action === 'enter') {
            if (itemCount === 0) return;
            const picked = sel.filteredItems[sel.selected];
            const cmdName = sel.commandName;
            dismissOverlay(ctx);
            if (picked) {
                clearComposer(composer);
                appendTextToComposer(composer, `/${cmdName} ${picked.value}`);
                handleKeyInput(ctx, '\r');
            }
            return;
        } else if (action === 'backspace') {
            sel.filter = sel.filter.slice(0, -1);
            sel.filteredItems = filterSelectorItems(sel.allItems, sel.filter);
            sel.selected = Math.min(sel.selected, Math.max(0, sel.filteredItems.length - 1));
        } else if (action === 'printable') {
            sel.filter += key;
            sel.filteredItems = filterSelectorItems(sel.allItems, sel.filter);
            sel.selected = Math.min(sel.selected, Math.max(0, sel.filteredItems.length - 1));
        } else {
            return;
        }
        ctx.overlayBoxHeight = renderChoiceSelector({
            write: (chunk) => process.stdout.write(chunk),
            cols: process.stdout.columns || 80,
            rows: getRows(),
            dimCode: c.dim, resetCode: c.reset,
            title: sel.title, subtitle: sel.subtitle,
            filter: sel.filter, items: sel.filteredItems, selected: sel.selected,
        });
        return;
    }

    // ─── Autocomplete navigation ─────────────
    const acRenderOpts = {
        write: (chunk: string) => process.stdout.write(chunk),
        columns: process.stdout.columns || 80,
        dimCode: c.dim, resetCode: c.reset, clipTextToCols,
    };

    if (ac.open && action === 'arrow-up') {
        ac.selected = Math.max(0, ac.selected - 1);
        if (ac.selected < ac.windowStart) ac.windowStart = ac.selected;
        renderAutocomplete(ac, acRenderOpts);
        return;
    }
    if (ac.open && action === 'arrow-down') {
        const maxIdx = ac.items.length - 1;
        ac.selected = Math.min(maxIdx, ac.selected + 1);
        if (ac.selected >= ac.windowStart + ac.visibleRows) {
            ac.windowStart = ac.selected - ac.visibleRows + 1;
        }
        renderAutocomplete(ac, acRenderOpts);
        return;
    }
    if (ac.open && action === 'page-up') {
        const step = Math.max(1, ac.visibleRows);
        ac.selected = Math.max(0, ac.selected - step);
        if (ac.selected < ac.windowStart) ac.windowStart = ac.selected;
        renderAutocomplete(ac, acRenderOpts);
        return;
    }
    if (ac.open && action === 'page-down') {
        const step = Math.max(1, ac.visibleRows);
        const maxIdx = ac.items.length - 1;
        ac.selected = Math.min(maxIdx, ac.selected + step);
        if (ac.selected >= ac.windowStart + ac.visibleRows) {
            ac.windowStart = ac.selected - ac.visibleRows + 1;
        }
        renderAutocomplete(ac, acRenderOpts);
        return;
    }
    if (ac.open && action === 'home') {
        ac.selected = 0;
        ac.windowStart = 0;
        renderAutocomplete(ac, acRenderOpts);
        return;
    }
    if (ac.open && action === 'end') {
        ac.selected = Math.max(0, ac.items.length - 1);
        if (ac.selected >= ac.windowStart + ac.visibleRows) {
            ac.windowStart = ac.selected - ac.visibleRows + 1;
        }
        renderAutocomplete(ac, acRenderOpts);
        return;
    }
    if (ac.open && action === 'tab') {
        const picked = ac.items[ac.selected];
        const pickedStage = ac.stage;
        if (picked) {
            clearComposer(composer);
            if (pickedStage === 'argument') {
                appendTextToComposer(composer, picked.insertText || `/${picked.command || ''} ${picked.name}`.trim());
            } else {
                appendTextToComposer(composer, `/${picked.name}${picked.args ? ' ' : ''}`);
            }
            closeAutocomplete(ac, (chunk) => process.stdout.write(chunk));
            redrawPromptLine(ctx);
        }
        return;
    }

    // ─── Enter: submit ───────────────────────
    if (action === 'enter') {
        if (ac.open) {
            const picked = ac.items[ac.selected];
            const pickedStage = ac.stage;
            closeAutocomplete(ac, (chunk) => process.stdout.write(chunk));
            if (picked) {
                clearComposer(composer);
                if (pickedStage === 'argument') {
                    appendTextToComposer(composer, picked.insertText || `/${picked.command || ''} ${picked.name}`.trim());
                    redrawPromptLine(ctx);
                    return;
                }
                if (picked.args) {
                    appendTextToComposer(composer, `/${picked.name} `);
                    redrawPromptLine(ctx);
                    return;
                }
                appendTextToComposer(composer, `/${picked.name}`);
            }
        }
        // Backslash continuation
        const trailing = getTrailingTextSegment(composer);
        if (trailing.text.endsWith('\\')) {
            trailing.text = trailing.text.slice(0, -1);
            appendNewlineToComposer(composer);
            redrawInputWithAutocomplete(ctx);
            return;
        }
        const draft = getPlainCommandDraft(composer);
        const displayText = getComposerDisplayText(composer);
        const text = flattenComposerForSubmit(composer).trim();
        clearComposer(composer);
        closeAutocomplete(ac, (chunk) => process.stdout.write(chunk));
        ctx.prevLineCount = 1;

        if (!text) { reopenPromptLine(ctx); return; }
        renderBlockSeparator();
        appendUserItem(ctx.store.transcript, displayText.trim(), text);
        // /file command
        if (draft !== null && text.startsWith('/file ')) {
            const parts = text.slice(6).trim().split(/\s+/);
            const fp = resolvePath(parts[0]!);
            const caption = parts.slice(1).join(' ');
            if (!fs.existsSync(fp)) {
                console.log(`  ${c.red}\uD30C\uC77C \uC5C6\uC74C: ${fp}${c.reset}`);
                openPromptBlock(ctx);
                return;
            }
            const prompt = `[\uC0AC\uC6A9\uC790\uAC00 \uD30C\uC77C\uC744 \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4: ${fp}]\n\uC774 \uD30C\uC77C\uC744 Read \uB3C4\uAD6C\uB85C \uC77D\uACE0 \uBD84\uC11D\uD574\uC8FC\uC138\uC694.${caption ? `\n\n\uC0AC\uC6A9\uC790 \uBA54\uC2DC\uC9C0: ${caption}` : ''}`;
            if (ctx.ideEnabled && ctx.isGit) {
                ctx.preFileSetQueue.push(captureFileSet(ctx.chatCwd));
            }
            ctx.ws.send(JSON.stringify({ type: 'send_message', text: prompt }));
            ctx.inputActive = false;
            return;
        }
        const parsed = draft !== null ? parseCommand(text) : null;
        if (parsed) {
            ctx.inputActive = false;
            ctx.commandRunning = true;
            void runSlashCommand(ctx, parsed);
            return;
        }
        if (ctx.ideEnabled && ctx.isGit) {
            ctx.preFileSetQueue.push(captureFileSet(ctx.chatCwd));
        }
        ctx.ws.send(JSON.stringify({ type: 'send_message', text }));
        ctx.inputActive = false;
    } else if (action === 'backspace') {
        backspaceComposer(composer);
        redrawInputWithAutocomplete(ctx);
    } else if (action === 'ctrl-c') {
        if (!ctx.inputActive) {
            if (ctx.commandRunning) return;
            ctx.ws.send(JSON.stringify({ type: 'stop' }));
            console.log(`\n  ${c.yellow}\u25A0 stopped${c.reset}`);
            ctx.inputActive = true;
            openPromptBlock(ctx);
        } else {
            cleanupScrollRegion(resolveShellLayout(process.stdout.columns || 80, getRows(), panes));
            console.log(`\n  ${c.dim}Bye! \uD83E\uDD9E${c.reset}\n`);
            setBracketedPaste(false);
            ctx.ws.close();
            process.stdin.setRawMode(false);
            process.exit(0);
        }
    } else if (action === 'ctrl-u') {
        clearComposer(composer);
        redrawInputWithAutocomplete(ctx);
    } else if (action === 'printable') {
        if (!ctx.inputActive) {
            if (ctx.commandRunning) return;
            ctx.inputActive = true;
            openPromptBlock(ctx);
        }
        appendTextToComposer(composer, key);
        redrawInputWithAutocomplete(ctx);
    }
}

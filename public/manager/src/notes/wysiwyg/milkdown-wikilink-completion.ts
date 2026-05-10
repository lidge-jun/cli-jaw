import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { NotesNoteMetadata } from '../notes-types';
import {
    formatWikiLinkCompletion,
    getWikiLinkCompletionRange,
    getWikiLinkSuggestions,
    type WikiLinkSuggestion,
} from '../wiki-link-suggestions';

export type MilkdownWikiLinkCompletionRuntime = {
    notes: readonly NotesNoteMetadata[];
};

type WikiLinkCompletionState = {
    active: boolean;
    from: number;
    to: number;
    query: string;
    selected: number;
    suggestions: WikiLinkSuggestion[];
};

type CompletionMeta = {
    close?: boolean;
    move?: number;
    refresh?: boolean;
};

const inactiveState: WikiLinkCompletionState = {
    active: false,
    from: 0,
    to: 0,
    query: '',
    selected: 0,
    suggestions: [],
};

export const notesWikiLinkCompletionPluginKey = new PluginKey<WikiLinkCompletionState>('NOTES_WYSIWYG_WIKILINK_COMPLETION');

export function requestWysiwygWikiLinkCompletionRefresh(view: EditorView): void {
    view.dispatch(view.state.tr.setMeta(notesWikiLinkCompletionPluginKey, { refresh: true }));
}

function clampSelected(selected: number, suggestions: readonly WikiLinkSuggestion[]): number {
    if (suggestions.length === 0) return 0;
    return Math.max(0, Math.min(selected, suggestions.length - 1));
}

function buildCompletionState(
    state: EditorState,
    runtime: MilkdownWikiLinkCompletionRuntime,
    previous?: WikiLinkCompletionState,
): WikiLinkCompletionState {
    if (!state.selection.empty) return inactiveState;
    const { $from } = state.selection;
    const blockStart = $from.start();
    const textBeforeCursor = state.doc.textBetween(blockStart, $from.pos, '\n', '\n');
    const range = getWikiLinkCompletionRange(textBeforeCursor);
    if (!range) return inactiveState;
    const suggestions = getWikiLinkSuggestions(runtime.notes, range.query);
    const selected = previous?.active && previous.query === range.query
        ? clampSelected(previous.selected, suggestions)
        : 0;
    return {
        active: true,
        from: blockStart + range.from,
        to: blockStart + range.to,
        query: range.query,
        selected,
        suggestions,
    };
}

function applySuggestion(view: EditorView, state: WikiLinkCompletionState, suggestion: WikiLinkSuggestion): void {
    view.dispatch(
        view.state.tr
            .insertText(formatWikiLinkCompletion(suggestion), state.from, state.to)
            .setMeta(notesWikiLinkCompletionPluginKey, { close: true })
            .scrollIntoView(),
    );
    view.focus();
}

function createCompletionPopup(state: WikiLinkCompletionState, view: EditorView): HTMLElement {
    const anchor = document.createElement('span');
    anchor.className = 'notes-wikilink-completion-anchor';
    const popup = document.createElement('div');
    popup.className = 'notes-wikilink-completion';
    popup.setAttribute('role', 'listbox');
    popup.setAttribute('aria-label', 'Wiki link suggestions');

    state.suggestions.forEach((suggestion, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'notes-wikilink-completion-item';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', index === state.selected ? 'true' : 'false');
        item.addEventListener('mousedown', event => {
            event.preventDefault();
        });
        item.addEventListener('click', event => {
            event.preventDefault();
            applySuggestion(view, state, suggestion);
        });

        const title = document.createElement('span');
        title.className = 'notes-wikilink-completion-title';
        title.textContent = suggestion.title || suggestion.path;
        const path = document.createElement('span');
        path.className = 'notes-wikilink-completion-path';
        path.textContent = suggestion.path;
        const meta = document.createElement('span');
        meta.className = 'notes-wikilink-completion-meta';
        meta.textContent = suggestion.matchKind;

        item.append(title, path, meta);
        popup.append(item);
    });

    anchor.append(popup);
    return anchor;
}

function moveSelection(view: EditorView, state: WikiLinkCompletionState, delta: number): void {
    if (state.suggestions.length === 0) return;
    const next = (state.selected + delta + state.suggestions.length) % state.suggestions.length;
    view.dispatch(view.state.tr.setMeta(notesWikiLinkCompletionPluginKey, { move: next - state.selected }));
}

export function notesMilkdownWikiLinkCompletionPlugin(runtime: MilkdownWikiLinkCompletionRuntime): MilkdownPlugin[] {
    const plugin = $prose(() => new Plugin<WikiLinkCompletionState>({
        key: notesWikiLinkCompletionPluginKey,
        state: {
            init: (_, state) => buildCompletionState(state, runtime),
            apply: (tr, value, _oldState, newState) => {
                const meta = tr.getMeta(notesWikiLinkCompletionPluginKey) as CompletionMeta | undefined;
                if (meta?.close) return inactiveState;
                if (!tr.docChanged && !tr.selectionSet && !meta?.refresh && meta?.move == null) return value;
                const next = buildCompletionState(newState, runtime, value);
                if (!next.active) return next;
                if (meta?.move != null && next.suggestions.length > 0) {
                    return {
                        ...next,
                        selected: (value.selected + meta.move + next.suggestions.length) % next.suggestions.length,
                    };
                }
                return next;
            },
        },
        props: {
            decorations(this: Plugin<WikiLinkCompletionState>, state) {
                const current = this.getState(state);
                if (!current?.active || current.suggestions.length === 0) return DecorationSet.empty;
                return DecorationSet.create(state.doc, [
                    Decoration.widget(current.to, view => createCompletionPopup(current, view), {
                        key: `notes-wikilink-completion-${current.from}-${current.to}-${current.query}-${current.selected}`,
                        side: 1,
                        stopEvent: event => event.type === 'mousedown' || event.type === 'click',
                    }),
                ]);
            },
            handleKeyDown(view, event) {
                const current = notesWikiLinkCompletionPluginKey.getState(view.state);
                if (!current?.active || current.suggestions.length === 0) return false;
                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    moveSelection(view, current, 1);
                    return true;
                }
                if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    moveSelection(view, current, -1);
                    return true;
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    view.dispatch(view.state.tr.setMeta(notesWikiLinkCompletionPluginKey, { close: true }));
                    return true;
                }
                if (event.key === 'Enter') {
                    event.preventDefault();
                    const suggestion = current.suggestions[current.selected];
                    if (suggestion) applySuggestion(view, current, suggestion);
                    return true;
                }
                return false;
            },
        },
    }));
    return [plugin];
}

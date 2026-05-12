import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { EditorState } from '@milkdown/kit/prose/state';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { NotesNoteLinkRef, NotesNoteMetadata } from '../notes-types';
import { resolveClientWikiLink, WIKI_LINK_RE, wikiLinkDisplayText, wikiLinkReasonLabel } from '../wiki-link-resolver';

export type MilkdownWikiLinkRuntime = {
    outgoing: readonly NotesNoteLinkRef[];
    notes: readonly NotesNoteMetadata[];
    onNavigate: (path: string) => void;
};

type WikiLinkPluginState = {
    decorations: DecorationSet;
    focused: boolean;
};

type WikiLinkPluginMeta = {
    focused?: boolean;
    refresh?: boolean;
};

export const notesWikiLinkPluginKey = new PluginKey<WikiLinkPluginState>('NOTES_WYSIWYG_WIKILINKS');

export function requestWysiwygWikiLinkRefresh(view: EditorView): void {
    view.dispatch(view.state.tr.setMeta(notesWikiLinkPluginKey, { refresh: true }));
}

function shouldSkipTextNode(node: ProseMirrorNode): boolean {
    return node.marks.some(mark => mark.type.name === 'inlineCode' || mark.type.name === 'link');
}

function selectionOverlaps(from: number, to: number, selectionFrom: number, selectionTo: number): boolean {
    if (selectionFrom === selectionTo) return selectionFrom > from && selectionFrom < to;
    return selectionFrom < to && selectionTo > from;
}

export function shouldHideWikiLinkSource(
    from: number,
    to: number,
    selectionFrom: number,
    selectionTo: number,
    focused: boolean,
): boolean {
    if (!focused) return true;
    return !selectionOverlaps(from, to, selectionFrom, selectionTo);
}

function createWikiLinkLabel(link: NotesNoteLinkRef, raw: string, runtime: MilkdownWikiLinkRuntime): HTMLElement {
    const resolved = link.status === 'resolved' && Boolean(link.resolvedPath);
    const label = document.createElement(resolved ? 'button' : 'span');
    label.className = resolved
        ? 'notes-wikilink notes-wikilink-live'
        : 'notes-wikilink notes-wikilink-live is-broken';
    label.textContent = wikiLinkDisplayText(link, raw);
    label.dataset['notesWikiRaw'] = raw;
    label.title = link.resolvedPath ?? wikiLinkReasonLabel(link);
    if (resolved && link.resolvedPath) {
        label.dataset['notesWikiPath'] = link.resolvedPath;
        if (label instanceof HTMLButtonElement) label.type = 'button';
        label.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            runtime.onNavigate(link.resolvedPath!);
        });
    }
    return label;
}

function buildWikiLinkDecorations(
    state: EditorState,
    runtime: MilkdownWikiLinkRuntime,
    focused: boolean,
): DecorationSet {
    const decorations: Decoration[] = [];
    const { from: selectionFrom, to: selectionTo } = state.selection;

    state.doc.descendants((node, pos) => {
        if (node.type.name === 'code_block') return false;
        if (!node.isText || shouldSkipTextNode(node)) return true;
        const text = node.text ?? '';
        WIKI_LINK_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = WIKI_LINK_RE.exec(text)) !== null) {
            const raw = match[0];
            const from = pos + match.index;
            const link = resolveClientWikiLink(raw, runtime.outgoing, runtime.notes, from);
            if (!link) continue;
            const to = from + raw.length;
            const hidden = shouldHideWikiLinkSource(from, to, selectionFrom, selectionTo, focused);
            decorations.push(Decoration.inline(from, to, {
                class: 'notes-wikilink-source',
                'data-notes-wiki-raw': raw,
                'data-notes-wiki-hidden': hidden ? 'true' : 'false',
            }, { inclusiveStart: false, inclusiveEnd: false }));
            if (hidden) {
                decorations.push(Decoration.widget(from, createWikiLinkLabel(link, raw, runtime), {
                    key: `notes-wikilink-${from}-${to}-${raw}`,
                    side: -1,
                    stopEvent: event => event.type === 'click' || event.type === 'mousedown',
                }));
            }
        }
        return true;
    });
    return DecorationSet.create(state.doc, decorations);
}

export function notesMilkdownWikiLinkPlugin(runtime: MilkdownWikiLinkRuntime): MilkdownPlugin[] {
    const plugin = $prose(() => new Plugin<WikiLinkPluginState>({
        key: notesWikiLinkPluginKey,
        state: {
            init: (_, state) => ({
                decorations: buildWikiLinkDecorations(state, runtime, false),
                focused: false,
            }),
            apply: (tr, value, _oldState, newState) => {
                const meta = tr.getMeta(notesWikiLinkPluginKey) as WikiLinkPluginMeta | undefined;
                const focused = typeof meta?.focused === 'boolean' ? meta.focused : value.focused;
                if (!tr.docChanged && !tr.selectionSet && !meta?.refresh && meta?.focused == null) {
                    return {
                        focused,
                        decorations: value.decorations.map(tr.mapping, tr.doc),
                    };
                }
                return {
                    focused,
                    decorations: buildWikiLinkDecorations(newState, runtime, focused),
                };
            },
        },
        props: {
            decorations(this: Plugin<WikiLinkPluginState>, state) {
                return this.getState(state)?.decorations ?? DecorationSet.empty;
            },
            handleDOMEvents: {
                focus(view) {
                    view.dispatch(view.state.tr.setMeta(notesWikiLinkPluginKey, { focused: true, refresh: true }));
                    return false;
                },
                blur(view) {
                    view.dispatch(view.state.tr.setMeta(notesWikiLinkPluginKey, { focused: false, refresh: true }));
                    return false;
                },
            },
        },
    }));
    return [plugin];
}

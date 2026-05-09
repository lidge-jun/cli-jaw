import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { EditorState } from '@milkdown/kit/prose/state';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { NotesNoteLinkRef, NotesNoteMetadata } from '../notes-types';
import { parseWikiLinkToken, WIKI_LINK_RE, wikiLinkDisplayText, wikiLinkReasonLabel } from '../wiki-link-rendering';

export type MilkdownWikiLinkRuntime = {
    outgoing: readonly NotesNoteLinkRef[];
    notes: readonly NotesNoteMetadata[];
    onNavigate: (path: string) => void;
};

export const notesWikiLinkPluginKey = new PluginKey<DecorationSet>('NOTES_WYSIWYG_WIKILINKS');

export function requestWysiwygWikiLinkRefresh(view: EditorView): void {
    view.dispatch(view.state.tr.setMeta(notesWikiLinkPluginKey, { refresh: true }));
}

function shouldSkipTextNode(node: ProseMirrorNode): boolean {
    return node.marks.some(mark => mark.type.name === 'inlineCode' || mark.type.name === 'link');
}

function buildLookup(outgoing: readonly NotesNoteLinkRef[]): Map<string, NotesNoteLinkRef> {
    const lookup = new Map<string, NotesNoteLinkRef>();
    for (const link of outgoing) {
        if (!lookup.has(link.raw)) lookup.set(link.raw, link);
    }
    return lookup;
}

function noteStem(path: string): string {
    const filename = path.split('/').at(-1) || path;
    return filename.endsWith('.md') ? filename.slice(0, -3) : filename;
}

function invalidTarget(target: string): boolean {
    if (!target || target.includes('\0') || target.includes('\\') || target.startsWith('/')) return true;
    if (target.includes('../')) return true;
    return target.split('/').some(part => !part || part === '.' || part === '..');
}

function fallbackLink(raw: string, runtime: MilkdownWikiLinkRuntime, startOffset: number): NotesNoteLinkRef | null {
    const parsed = parseWikiLinkToken(raw);
    if (!parsed) return null;
    const base: NotesNoteLinkRef = {
        sourcePath: '',
        raw,
        target: parsed.target,
        ...(parsed.displayText ? { displayText: parsed.displayText } : {}),
        ...(parsed.heading ? { heading: parsed.heading } : {}),
        line: 0,
        column: 0,
        startOffset,
        endOffset: startOffset + raw.length,
        status: 'missing',
        reason: invalidTarget(parsed.target) ? 'invalid_target' : 'not_found',
    };
    if (base.reason === 'invalid_target') return base;

    const targetNoExt = parsed.target.endsWith('.md') ? parsed.target.slice(0, -3) : parsed.target;
    const candidates = runtime.notes.filter(note => {
        const pathNoExt = note.path.endsWith('.md') ? note.path.slice(0, -3) : note.path;
        return note.path === parsed.target
            || pathNoExt === targetNoExt
            || note.aliases.includes(parsed.target)
            || (!parsed.target.includes('/') && noteStem(note.path) === targetNoExt);
    });
    if (candidates.length === 1 && candidates[0]) {
        const { reason: _reason, ...withoutReason } = base;
        return { ...withoutReason, status: 'resolved', resolvedPath: candidates[0].path };
    }
    if (candidates.length > 1) {
        return {
            ...base,
            status: 'ambiguous',
            reason: 'ambiguous',
            candidatePaths: candidates.map(note => note.path).sort((a, b) => a.localeCompare(b)),
        };
    }
    return base;
}

function selectionOverlaps(from: number, to: number, selectionFrom: number, selectionTo: number): boolean {
    return selectionFrom <= to && selectionTo >= from;
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
): DecorationSet {
    const lookup = buildLookup(runtime.outgoing);
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
            const link = lookup.get(raw) ?? fallbackLink(raw, runtime, from);
            if (!link) continue;
            const to = from + raw.length;
            const hidden = !selectionOverlaps(from, to, selectionFrom, selectionTo);
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
    const plugin = $prose(() => new Plugin<DecorationSet>({
        key: notesWikiLinkPluginKey,
        state: {
            init: (_, state) => buildWikiLinkDecorations(state, runtime),
            apply: (tr, value, _oldState, newState) => {
                if (!tr.docChanged && !tr.selectionSet && !tr.getMeta(notesWikiLinkPluginKey)) {
                    return value.map(tr.mapping, tr.doc);
                }
                return buildWikiLinkDecorations(newState, runtime);
            },
        },
        props: {
            decorations(this: Plugin<DecorationSet>, state) {
                return this.getState(state);
            },
        },
    }));
    return [plugin];
}

import {
    autocompletion,
    insertCompletionText,
    pickedCompletion,
    type Completion,
    type CompletionContext,
    type CompletionResult,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { NotesNoteMetadata } from './notes-types';
import {
    formatWikiLinkCompletion,
    getWikiLinkCompletionRangeAtCursor,
    getWikiLinkSuggestions,
} from './wiki-link-suggestions';

function wikiLinkCompletionApply(suggestion: ReturnType<typeof getWikiLinkSuggestions>[number]): NonNullable<Completion['apply']> {
    return (view, completion, from, to) => {
        const toWithClosingSuffix = view.state.sliceDoc(to, to + 2) === ']]' ? to + 2 : to;
        view.dispatch({
            ...insertCompletionText(view.state, formatWikiLinkCompletion(suggestion), from, toWithClosingSuffix),
            annotations: pickedCompletion.of(completion),
        });
    };
}

export function wikiLinkCodeMirrorCompletion(notes: readonly NotesNoteMetadata[]): Extension {
    function source(context: CompletionContext): CompletionResult | null {
        const line = context.state.doc.lineAt(context.pos);
        const lineText = context.state.sliceDoc(line.from, line.to);
        const range = getWikiLinkCompletionRangeAtCursor(lineText, context.pos - line.from);
        if (!range) return null;
        const completionTo = line.from + range.to - (range.hasClosingSuffix ? 2 : 0);
        const options: Completion[] = getWikiLinkSuggestions(notes, range.query).map(suggestion => ({
            label: suggestion.title || suggestion.path,
            detail: suggestion.path,
            info: suggestion.matchKind === 'alias' ? `Alias: ${suggestion.aliases.join(', ')}` : suggestion.matchKind,
            type: 'text',
            apply: wikiLinkCompletionApply(suggestion),
            boost: suggestion.score,
        }));
        if (options.length === 0) return null;
        return {
            from: line.from + range.from,
            to: completionTo,
            options,
            validFor: /^[^\]\n]*$/,
        };
    }

    return autocompletion({
        activateOnTyping: true,
        override: [source],
    });
}

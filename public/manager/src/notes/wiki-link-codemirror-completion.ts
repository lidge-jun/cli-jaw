import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { NotesNoteMetadata } from './notes-types';
import {
    formatWikiLinkCompletion,
    getWikiLinkCompletionRange,
    getWikiLinkSuggestions,
} from './wiki-link-suggestions';

export function wikiLinkCodeMirrorCompletion(notes: readonly NotesNoteMetadata[]): Extension {
    function source(context: CompletionContext): CompletionResult | null {
        const line = context.state.doc.lineAt(context.pos);
        const before = context.state.sliceDoc(line.from, context.pos);
        const range = getWikiLinkCompletionRange(before);
        if (!range) return null;
        const options: Completion[] = getWikiLinkSuggestions(notes, range.query).map(suggestion => ({
            label: suggestion.title || suggestion.path,
            detail: suggestion.path,
            info: suggestion.matchKind === 'alias' ? `Alias: ${suggestion.aliases.join(', ')}` : suggestion.matchKind,
            type: 'text',
            apply: formatWikiLinkCompletion(suggestion),
            boost: suggestion.score,
        }));
        if (options.length === 0) return null;
        return {
            from: line.from + range.from,
            to: line.from + range.to,
            options,
            validFor: /^[^\]\n]*$/,
        };
    }

    return autocompletion({
        activateOnTyping: true,
        override: [source],
    });
}

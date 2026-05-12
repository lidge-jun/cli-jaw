import type { NotesNoteMetadata } from './notes-types';

const DEFAULT_SUGGESTION_LIMIT = 20;
const NOTE_FILE_EXT = '.md';

export type WikiLinkCompletionRange = {
    from: number;
    to: number;
    query: string;
};

export type WikiLinkCompletionRangeAtCursor = WikiLinkCompletionRange & {
    hasClosingSuffix: boolean;
};

export type WikiLinkSuggestion = {
    path: string;
    title: string;
    aliases: readonly string[];
    tags: readonly string[];
    insertText: string;
    matchKind: 'title' | 'alias' | 'path' | 'tag';
    score: number;
};

function lower(value: string): string {
    return value.trim().toLocaleLowerCase();
}

function pathWithoutExt(path: string): string {
    return path.endsWith(NOTE_FILE_EXT) ? path.slice(0, -NOTE_FILE_EXT.length) : path;
}

function noteStem(path: string): string {
    const filename = path.split('/').at(-1) || path;
    return pathWithoutExt(filename);
}

function isEscaped(text: string, index: number): boolean {
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor--) {
        backslashes++;
    }
    return backslashes % 2 === 1;
}

function titleCounts(notes: readonly NotesNoteMetadata[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const note of notes) {
        const title = note.title.trim();
        if (!title) continue;
        const key = lower(title);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}

function insertionText(note: NotesNoteMetadata, counts: Map<string, number>): string {
    const title = note.title.trim();
    if (title && counts.get(lower(title)) === 1) return title;
    return pathWithoutExt(note.path);
}

function scoreNote(
    note: NotesNoteMetadata,
    query: string,
): Pick<WikiLinkSuggestion, 'matchKind' | 'score'> | null {
    if (!query) return { matchKind: 'title', score: 1 };

    const normalizedTitle = lower(note.title);
    const normalizedPath = lower(note.path);
    const normalizedStem = lower(noteStem(note.path));
    if (normalizedTitle === query) return { matchKind: 'title', score: 100 };
    if (normalizedTitle.startsWith(query)) return { matchKind: 'title', score: 90 };

    for (const alias of note.aliases) {
        const normalizedAlias = lower(alias);
        if (normalizedAlias === query) return { matchKind: 'alias', score: 85 };
        if (normalizedAlias.startsWith(query)) return { matchKind: 'alias', score: 80 };
    }

    if (normalizedStem === query) return { matchKind: 'path', score: 75 };
    if (normalizedStem.startsWith(query)) return { matchKind: 'path', score: 70 };
    if (normalizedPath.includes(query)) return { matchKind: 'path', score: 50 };

    for (const tag of note.tags) {
        const normalizedTag = lower(tag).replace(/^#/, '');
        if (normalizedTag === query || normalizedTag.startsWith(query)) return { matchKind: 'tag', score: 40 };
    }

    return null;
}

export function getWikiLinkCompletionRange(textBeforeCursor: string): WikiLinkCompletionRange | null {
    if (!textBeforeCursor) return null;
    let open = textBeforeCursor.lastIndexOf('[[');
    while (open !== -1 && isEscaped(textBeforeCursor, open)) {
        open = textBeforeCursor.lastIndexOf('[[', open - 1);
    }
    if (open === -1) return null;
    const queryStart = open + 2;
    const query = textBeforeCursor.slice(queryStart);
    if (query.includes('\n') || query.includes(']') || query.includes('[')) return null;
    if (textBeforeCursor.slice(queryStart).includes(']]')) return null;
    return { from: queryStart, to: textBeforeCursor.length, query };
}

export function getWikiLinkCompletionRangeAtCursor(
    lineText: string,
    cursorOffset: number,
): WikiLinkCompletionRangeAtCursor | null {
    if (cursorOffset < 0 || cursorOffset > lineText.length) return null;
    const prefix = getWikiLinkCompletionRange(lineText.slice(0, cursorOffset));
    if (!prefix) return null;
    const hasClosingSuffix = lineText.slice(cursorOffset, cursorOffset + 2) === ']]';
    return {
        ...prefix,
        to: prefix.to + (hasClosingSuffix ? 2 : 0),
        hasClosingSuffix,
    };
}

export function getWikiLinkSuggestions(
    notes: readonly NotesNoteMetadata[],
    query: string,
    limit = DEFAULT_SUGGESTION_LIMIT,
): WikiLinkSuggestion[] {
    const normalizedQuery = lower(query);
    const counts = titleCounts(notes);
    const suggestions: WikiLinkSuggestion[] = [];
    for (const note of notes) {
        const scored = scoreNote(note, normalizedQuery);
        if (!scored) continue;
        suggestions.push({
            path: note.path,
            title: note.title,
            aliases: note.aliases,
            tags: note.tags,
            insertText: insertionText(note, counts),
            matchKind: scored.matchKind,
            score: scored.score,
        });
    }
    return suggestions
        .sort((a, b) => b.score - a.score
            || a.title.localeCompare(b.title)
            || a.path.localeCompare(b.path))
        .slice(0, limit);
}

export function formatWikiLinkCompletion(suggestion: WikiLinkSuggestion): string {
    return `${suggestion.insertText}]]`;
}

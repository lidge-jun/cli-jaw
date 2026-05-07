import { useCallback, useEffect, useRef, useState } from 'react';
import { searchNotes } from './notes-api';
import type { NoteSearchResult } from './notes-types';
import type { NotesSidebarMode } from './NotesSidebar';

type NotesSearchSidebarProps = {
    focusToken: number;
    onSelect: (path: string) => void;
    onModeChange: (mode: NotesSidebarMode) => void;
};

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 275;
const SEARCH_LIMIT = 20;

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

export function NotesSearchSidebar(props: NotesSearchSidebarProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<NoteSearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const cancelSearch = useCallback((): void => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        abortRef.current?.abort();
        abortRef.current = null;
    }, []);

    useEffect(() => {
        inputRef.current?.focus();
    }, [props.focusToken]);

    useEffect(() => {
        return () => cancelSearch();
    }, [cancelSearch]);

    const runSearch = useCallback((value: string): void => {
        const trimmed = value.trim();
        cancelSearch();
        setError(null);
        if (trimmed.length < MIN_QUERY_LENGTH) {
            setResults([]);
            setLoading(false);
            return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        void searchNotes(trimmed, { limit: SEARCH_LIMIT, signal: controller.signal })
            .then(nextResults => {
                if (!controller.signal.aborted) setResults(nextResults);
            })
            .catch(err => {
                if (controller.signal.aborted || isAbortError(err)) return;
                setResults([]);
                setError((err as Error).message || 'Search failed');
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
    }, [cancelSearch]);

    function handleQueryChange(value: string): void {
        setQuery(value);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => runSearch(value), SEARCH_DEBOUNCE_MS);
    }

    function handleKeyDown(event: React.KeyboardEvent): void {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        props.onModeChange('files');
    }

    return (
        <section className="notes-search-sidebar" aria-label="Search notes" onKeyDown={handleKeyDown}>
            <div className="notes-search-sidebar-header">
                <input
                    ref={inputRef}
                    className="notes-search-input"
                    type="search"
                    placeholder="Search notes"
                    value={query}
                    onChange={event => handleQueryChange(event.currentTarget.value)}
                    aria-label="Search notes"
                />
            </div>
            <div className="notes-search-sidebar-results" aria-live="polite">
                {loading && <div className="notes-search-loading">Searching...</div>}
                {error && <div className="notes-search-error">{error}</div>}
                {!error && results.map(result => (
                    <button
                        key={`${result.kind}:${result.path}:${result.line}:${result.context}`}
                        type="button"
                        className="notes-search-result"
                        onClick={() => props.onSelect(result.path)}
                    >
                        <span className="notes-search-result-path">{result.path}</span>
                        <span className="notes-search-result-line">
                            {result.kind === 'path' ? 'Path match' : `Line ${result.line}`}
                        </span>
                        <span className="notes-search-result-context">{result.context}</span>
                    </button>
                ))}
                {!loading && !error && query.trim().length >= MIN_QUERY_LENGTH && results.length === 0 && (
                    <div className="notes-search-empty">No results</div>
                )}
            </div>
        </section>
    );
}

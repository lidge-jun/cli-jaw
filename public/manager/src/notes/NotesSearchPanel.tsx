import { useCallback, useEffect, useRef, useState } from 'react';
import { searchNotes } from './notes-api';
import type { NoteSearchResult } from './notes-types';

type NotesSearchPanelProps = {
    open: boolean;
    onSelect: (path: string) => void;
    onClose: () => void;
};

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 275;
const SEARCH_LIMIT = 20;

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

export function NotesSearchPanel(props: NotesSearchPanelProps) {
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
        if (!props.open) {
            cancelSearch();
            setLoading(false);
            return;
        }
        inputRef.current?.focus();
    }, [props.open, cancelSearch]);

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
        if (event.key === 'Escape') props.onClose();
    }

    if (!props.open) return null;

    return (
        <aside className="notes-search-panel" aria-label="Search notes" onKeyDown={handleKeyDown}>
            <div className="notes-search-header">
                <input
                    ref={inputRef}
                    className="notes-search-input"
                    type="search"
                    placeholder="Search notes"
                    value={query}
                    onChange={event => handleQueryChange(event.currentTarget.value)}
                    aria-label="Search notes"
                />
                <button type="button" className="notes-search-close" aria-label="Close search" onClick={props.onClose}>X</button>
            </div>
            <div className="notes-search-results" aria-live="polite">
                {loading && <div className="notes-search-loading">Searching...</div>}
                {error && <div className="notes-search-error">{error}</div>}
                {!error && results.map(result => (
                    <button
                        key={`${result.path}:${result.line}:${result.context}`}
                        type="button"
                        className="notes-search-result"
                        onClick={() => props.onSelect(result.path)}
                    >
                        <span className="notes-search-result-path">{result.path}</span>
                        <span className="notes-search-result-line">Line {result.line}</span>
                        <span className="notes-search-result-context">{result.context}</span>
                    </button>
                ))}
                {!loading && !error && query.trim().length >= MIN_QUERY_LENGTH && results.length === 0 && (
                    <div className="notes-search-empty">No results</div>
                )}
            </div>
        </aside>
    );
}

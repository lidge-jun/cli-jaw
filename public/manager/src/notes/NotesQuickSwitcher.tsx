import { useEffect, useMemo, useRef, useState } from 'react';
import type { NoteMetadata } from '../types';

type NotesQuickSwitcherProps = {
    open: boolean;
    notes: NoteMetadata[];
    selectedPath: string | null;
    onSelect: (path: string) => void;
    onClose: () => void;
};

export type QuickSwitcherResult = {
    note: NoteMetadata;
    score: number;
    reason: 'title' | 'path' | 'alias';
};

const MAX_RESULTS = 50;

function normalize(value: string): string {
    return value.trim().toLowerCase();
}

function fuzzyScore(value: string, query: string): number | null {
    const haystack = normalize(value);
    const needle = normalize(query);
    if (!needle) return 1;
    if (haystack.startsWith(needle)) return 1000 - haystack.length;
    const contains = haystack.indexOf(needle);
    if (contains >= 0) return 700 - contains;

    let lastIndex = -1;
    let consecutive = 0;
    let score = 0;
    for (const char of needle) {
        const index = haystack.indexOf(char, lastIndex + 1);
        if (index < 0) return null;
        consecutive = index === lastIndex + 1 ? consecutive + 1 : 0;
        score += 4 + consecutive * 3 - Math.min(index, 40) * 0.1;
        lastIndex = index;
    }
    return score;
}

function scoreNote(note: NoteMetadata, query: string): QuickSwitcherResult | null {
    const candidates: Array<{ value: string; reason: QuickSwitcherResult['reason']; boost: number }> = [
        { value: note.title, reason: 'title', boost: 120 },
        { value: note.path, reason: 'path', boost: 40 },
        ...note.aliases.map(alias => ({ value: alias, reason: 'alias' as const, boost: 80 })),
    ];

    let best: QuickSwitcherResult | null = null;
    for (const candidate of candidates) {
        const fieldScore = fuzzyScore(candidate.value, query);
        if (fieldScore == null) continue;
        const scored = fieldScore + candidate.boost;
        if (!best || scored > best.score) {
            best = { note, score: scored, reason: candidate.reason };
        }
    }
    return best;
}

export function filterQuickSwitcherNotes(notes: NoteMetadata[], query: string, limit = MAX_RESULTS): QuickSwitcherResult[] {
    const trimmed = query.trim();
    const results = notes
        .map(note => scoreNote(note, trimmed))
        .filter((result): result is QuickSwitcherResult => Boolean(result))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.note.path.localeCompare(b.note.path);
        });
    return results.slice(0, limit);
}

export function NotesQuickSwitcher(props: NotesQuickSwitcherProps) {
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);

    const results = useMemo(() => filterQuickSwitcherNotes(props.notes, query), [props.notes, query]);
    const activeId = results[activeIndex] ? `notes-quick-switcher-option-${activeIndex}` : undefined;

    useEffect(() => {
        if (!props.open) return;
        setQuery('');
        setActiveIndex(0);
        requestAnimationFrame(() => inputRef.current?.focus());
    }, [props.open]);

    useEffect(() => {
        if (activeIndex >= results.length) setActiveIndex(Math.max(0, results.length - 1));
    }, [activeIndex, results.length]);

    useEffect(() => {
        const active = activeId ? document.getElementById(activeId) : null;
        active?.scrollIntoView({ block: 'nearest' });
    }, [activeId]);

    function selectActive(): void {
        const result = results[activeIndex];
        if (!result) return;
        props.onSelect(result.note.path);
    }

    function handleInputKey(event: React.KeyboardEvent<HTMLInputElement>): void {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex(index => Math.min(results.length - 1, index + 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex(index => Math.max(0, index - 1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            selectActive();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            props.onClose();
        }
    }

    if (!props.open) return null;

    return (
        <div className="notes-quick-switcher-backdrop" role="presentation" onClick={props.onClose}>
            <section
                className="notes-quick-switcher"
                role="dialog"
                aria-modal="true"
                aria-label="Quick switch note"
                onClick={event => event.stopPropagation()}
            >
                <input
                    ref={inputRef}
                    className="notes-quick-switcher-input"
                    type="search"
                    placeholder="Go to note"
                    value={query}
                    onChange={event => { setQuery(event.currentTarget.value); setActiveIndex(0); }}
                    onKeyDown={handleInputKey}
                    aria-label="Quick switch note"
                    aria-controls="notes-quick-switcher-results"
                    aria-activedescendant={activeId}
                />
                <div
                    id="notes-quick-switcher-results"
                    className="notes-quick-switcher-list"
                    role="listbox"
                    aria-label="Matching notes"
                    ref={listRef}
                >
                    {results.map((result, index) => {
                        const active = index === activeIndex;
                        const current = result.note.path === props.selectedPath;
                        return (
                            <button
                                id={`notes-quick-switcher-option-${index}`}
                                key={result.note.path}
                                type="button"
                                role="option"
                                aria-selected={active}
                                className={`notes-quick-switcher-item${active ? ' is-active' : ''}${current ? ' is-current' : ''}`}
                                onMouseEnter={() => setActiveIndex(index)}
                                onClick={() => props.onSelect(result.note.path)}
                            >
                                <span className="notes-quick-switcher-title">{result.note.title || result.note.path}</span>
                                <span className="notes-quick-switcher-path">{result.note.path}</span>
                                <span className="notes-quick-switcher-alias">
                                    {current ? 'Current note' : result.reason === 'alias' ? 'Alias match' : result.reason === 'path' ? 'Path match' : 'Title match'}
                                </span>
                            </button>
                        );
                    })}
                    {results.length === 0 && (
                        <p className="notes-quick-switcher-empty">No matching notes.</p>
                    )}
                </div>
                <footer className="notes-quick-switcher-footer">
                    <span><kbd>Up/Down</kbd> move</span>
                    <span><kbd>Enter</kbd> open</span>
                    <span><kbd>Esc</kbd> close</span>
                </footer>
            </section>
        </div>
    );
}

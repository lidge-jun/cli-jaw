import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNotesIndex, fetchNotesInfo, fetchNotesTree } from './notes-api';
import { useInvalidationSubscription } from '../sync/useInvalidationSubscription';
import { useNotesExternalSync } from './useNotesExternalSync';
import type { NotesTreeEntry, NotesVaultIndexSnapshot } from './notes-types';

export type NotesModelState = {
    tree: NotesTreeEntry[];
    index: NotesVaultIndexSnapshot | null;
    loading: boolean;
    error: string | null;
    notesRoot: string | null;
    refresh: (selectPath?: string | null) => Promise<void>;
};

type UseNotesModelOptions = {
    active: boolean;
    selectedPath: string | null;
    onSelectedPathChange: (path: string | null) => void;
};

function firstFile(entries: NotesTreeEntry[]): string | null {
    for (const entry of entries) {
        if (entry.kind === 'file') return entry.path;
        const child = firstFile(entry.children || []);
        if (child) return child;
    }
    return null;
}

function hasFile(entries: NotesTreeEntry[], path: string): boolean {
    for (const entry of entries) {
        if (entry.kind === 'file' && entry.path === path) return true;
        if (hasFile(entry.children || [], path)) return true;
    }
    return false;
}

export function useNotesModel(options: UseNotesModelOptions): NotesModelState {
    const [tree, setTree] = useState<NotesTreeEntry[]>([]);
    const [index, setIndex] = useState<NotesVaultIndexSnapshot | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notesRoot, setNotesRoot] = useState<string | null>(null);
    const requestIdRef = useRef(0);

    useNotesExternalSync(options.active);

    useEffect(() => {
        if (!options.active || notesRoot) return;
        void fetchNotesInfo().then(info => setNotesRoot(info.root)).catch(() => {});
    }, [options.active, notesRoot]);

    const refresh = useCallback(async (selectPath = options.selectedPath): Promise<void> => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setError(null);
        try {
            const [nextTree, nextIndex] = await Promise.all([
                fetchNotesTree(),
                fetchNotesIndex(),
            ]);
            if (requestId !== requestIdRef.current) return;
            setTree(nextTree);
            setIndex(nextIndex);
            const nextSelected = selectPath && hasFile(nextTree, selectPath) ? selectPath : firstFile(nextTree);
            if (nextSelected !== options.selectedPath) options.onSelectedPathChange(nextSelected);
        } catch (err) {
            if (requestId === requestIdRef.current) setError((err as Error).message);
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    }, [options.selectedPath, options.onSelectedPathChange]);

    useInvalidationSubscription('notes', () => {
        if (options.active) void refresh();
    }, 'notes-sidebar');

    useEffect(() => {
        if (!options.active) return;
        void refresh();
    }, [options.active, refresh]);

    return { tree, index, loading, error, notesRoot, refresh };
}

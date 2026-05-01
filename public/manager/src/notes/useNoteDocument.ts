import { useCallback, useRef, useState } from 'react';
import type { DashboardNoteFileResponse } from '../types';
import { fetchNoteFile, saveNoteFile } from './notes-api';
import { isRevisionConflict } from './note-revisions';
import type { NoteConflictState } from './notes-types';

export type UseNoteDocumentResult = {
    file: DashboardNoteFileResponse | null;
    content: string;
    dirty: boolean;
    loading: boolean;
    saving: boolean;
    error: string | null;
    conflict: NoteConflictState | null;
    setContent: (value: string) => void;
    load: (path: string) => Promise<void>;
    save: () => Promise<void>;
    reloadFromDisk: () => Promise<void>;
    overwrite: () => Promise<void>;
    clearConflict: () => void;
};

export function useNoteDocument(): UseNoteDocumentResult {
    const [file, setFile] = useState<DashboardNoteFileResponse | null>(null);
    const [content, setContentState] = useState('');
    const [dirty, setDirty] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [conflict, setConflict] = useState<NoteConflictState | null>(null);
    const latestContentRef = useRef('');
    const savingRef = useRef(false);

    const load = useCallback(async (path: string): Promise<void> => {
        setLoading(true);
        setError(null);
        setConflict(null);
        try {
            const next = await fetchNoteFile(path);
            setFile(next);
            latestContentRef.current = next.content;
            setContentState(next.content);
            setDirty(false);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    function setContent(value: string): void {
        latestContentRef.current = value;
        setContentState(value);
        setDirty(true);
    }

    const save = useCallback(async (): Promise<void> => {
        if (!file || !dirty || savingRef.current) return;
        const contentSnapshot = latestContentRef.current;
        savingRef.current = true;
        setSaving(true);
        setError(null);
        setConflict(null);
        try {
            const saved = await saveNoteFile({
                path: file.path,
                content: contentSnapshot,
                baseRevision: file.revision,
            });
            setFile(saved);
            if (latestContentRef.current === contentSnapshot) {
                latestContentRef.current = saved.content;
                setContentState(saved.content);
                setDirty(false);
            }
        } catch (err) {
            if (isRevisionConflict(err)) {
                let remoteRevision = file.revision;
                try {
                    const remote = await fetchNoteFile(file.path);
                    remoteRevision = remote.revision;
                    setFile(remote);
                } catch {
                    remoteRevision = file.revision;
                }
                setConflict({
                    localContent: contentSnapshot,
                    remoteRevision,
                    message: (err as Error).message,
                });
            } else {
                setError((err as Error).message);
            }
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }, [dirty, file]);

    const reloadFromDisk = useCallback(async (): Promise<void> => {
        if (!file) return;
        await load(file.path);
    }, [file, load]);

    const overwrite = useCallback(async (): Promise<void> => {
        if (!file || savingRef.current) return;
        const contentSnapshot = latestContentRef.current;
        savingRef.current = true;
        setSaving(true);
        setError(null);
        try {
            const saved = await saveNoteFile({ path: file.path, content: contentSnapshot });
            setFile(saved);
            if (latestContentRef.current === contentSnapshot) {
                latestContentRef.current = saved.content;
                setContentState(saved.content);
                setDirty(false);
            }
            setConflict(null);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }, [file]);

    return {
        file,
        content,
        dirty,
        loading,
        saving,
        error,
        conflict,
        setContent,
        load,
        save,
        reloadFromDisk,
        overwrite,
        clearConflict: () => setConflict(null),
    };
}

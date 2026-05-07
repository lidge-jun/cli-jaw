import type {
    DashboardNoteFileResponse,
    DashboardNoteSearchResult,
    DashboardNotesCapabilities,
    DashboardNoteTreeEntry,
    VaultIndexSnapshot,
} from '../types';

export type NotesViewMode = 'raw' | 'split' | 'preview' | 'settings';
export type NotesAuthoringMode = 'plain' | 'rich' | 'wysiwyg';

export type NotesTreeSelection = {
    selectedPath: string | null;
};

export type NoteConflictState = {
    localContent: string;
    remoteRevision: string;
    message: string;
};

export type NotesTreeEntry = DashboardNoteTreeEntry;
export type NoteFile = DashboardNoteFileResponse;
export type NoteSearchResult = DashboardNoteSearchResult;
export type NotesVaultIndexSnapshot = VaultIndexSnapshot;
export type NotesCapabilities = DashboardNotesCapabilities;

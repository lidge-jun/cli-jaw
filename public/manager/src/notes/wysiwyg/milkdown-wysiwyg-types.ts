import type { NotesNoteLinkRef, NotesNoteMetadata } from '../notes-types';

export type MilkdownWysiwygEditorProps = {
    active: boolean;
    content: string;
    notePath: string;
    outgoing: readonly NotesNoteLinkRef[];
    notes: readonly NotesNoteMetadata[];
    activeTag: string | null;
    onChange: (value: string) => void;
    onTagSelect: (tag: string | null) => void;
    onWikiLinkNavigate: (path: string) => void;
};

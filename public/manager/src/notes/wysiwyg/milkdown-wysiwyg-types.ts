import type { NotesNoteLinkRef } from '../notes-types';

export type MilkdownWysiwygEditorProps = {
    active: boolean;
    content: string;
    notePath: string;
    outgoing: readonly NotesNoteLinkRef[];
    activeTag: string | null;
    onChange: (value: string) => void;
    onTagSelect: (tag: string | null) => void;
    onWikiLinkNavigate: (path: string) => void;
};

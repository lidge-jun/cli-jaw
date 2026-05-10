import { MarkdownRenderer } from './rendering/MarkdownRenderer';
import type { NotesNoteLinkRef, NotesNoteMetadata } from './notes-types';

type MarkdownPreviewProps = {
    markdown: string;
    outgoing?: NotesNoteLinkRef[] | undefined;
    notes?: readonly NotesNoteMetadata[] | undefined;
    onWikiLinkNavigate?: ((path: string) => void) | undefined;
};

export function MarkdownPreview(props: MarkdownPreviewProps) {
    return (
        <article className="notes-preview">
            <MarkdownRenderer
                markdown={props.markdown}
                outgoing={props.outgoing}
                notes={props.notes}
                onWikiLinkNavigate={props.onWikiLinkNavigate}
            />
        </article>
    );
}

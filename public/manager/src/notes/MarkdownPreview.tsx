import { MarkdownRenderer } from './rendering/MarkdownRenderer';
import type { NotesNoteLinkRef } from './notes-types';

type MarkdownPreviewProps = {
    markdown: string;
    outgoing?: NotesNoteLinkRef[] | undefined;
    onWikiLinkNavigate?: ((path: string) => void) | undefined;
};

export function MarkdownPreview(props: MarkdownPreviewProps) {
    return (
        <article className="notes-preview">
            <MarkdownRenderer
                markdown={props.markdown}
                outgoing={props.outgoing}
                onWikiLinkNavigate={props.onWikiLinkNavigate}
            />
        </article>
    );
}

import type { NotesNoteMetadata } from './notes-types';

type NotesFrontmatterStripProps = {
    note: NotesNoteMetadata | null;
    activeTag: string | null;
    onTagClick: (tag: string | null) => void;
};

export function NotesFrontmatterStrip(props: NotesFrontmatterStripProps) {
    const note = props.note;
    if (!note) return null;

    const aliases = note.aliases || [];
    const tags = note.tags || [];
    const created = note.created;
    const error = note.frontmatterError;

    const isEmpty = !error && aliases.length === 0 && tags.length === 0 && !created;
    if (isEmpty) return null;

    return (
        <div className="notes-frontmatter-strip" aria-label="Note frontmatter">
            {error && (
                <span className="notes-frontmatter-error" role="alert">
                    Frontmatter: {error}
                </span>
            )}
            {aliases.length > 0 && (
                <span className="notes-frontmatter-section">
                    <span className="notes-frontmatter-label">Aliases</span>
                    <span className="notes-frontmatter-value">{aliases.join(', ')}</span>
                </span>
            )}
            {created && (
                <span className="notes-frontmatter-section">
                    <span className="notes-frontmatter-label">Created</span>
                    <span className="notes-frontmatter-value">{created}</span>
                </span>
            )}
            {tags.length > 0 && (
                <span className="notes-frontmatter-section notes-frontmatter-tags">
                    {tags.map(tag => {
                        const active = tag === props.activeTag;
                        return (
                            <button
                                key={tag}
                                type="button"
                                className={active ? 'notes-tag-chip is-active' : 'notes-tag-chip'}
                                aria-pressed={active}
                                title={active ? `Clear filter: #${tag}` : `Filter notes by #${tag}`}
                                onClick={() => props.onTagClick(active ? null : tag)}
                            >
                                #{tag}
                            </button>
                        );
                    })}
                </span>
            )}
        </div>
    );
}

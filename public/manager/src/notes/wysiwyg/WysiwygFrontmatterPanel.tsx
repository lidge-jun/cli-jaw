import { updateWysiwygFrontmatter, type WysiwygFrontmatterData } from './wysiwyg-frontmatter';

type WysiwygFrontmatterPanelProps = {
    frontmatter: WysiwygFrontmatterData | null;
    activeTag: string | null;
    onChange: (frontmatter: WysiwygFrontmatterData | null) => void;
    onTagClick: (tag: string | null) => void;
};

function parseAliasesInput(value: string): string[] {
    return value.split(',').map(item => item.trim()).filter(Boolean);
}

function parseTagsInput(value: string): string[] {
    return value.split(/[\s,]+/u)
        .map(item => item.trim().replace(/^#/, '').trim())
        .filter(Boolean);
}

export function WysiwygFrontmatterPanel(props: WysiwygFrontmatterPanelProps) {
    const frontmatter = props.frontmatter;
    if (!frontmatter) return null;
    if (frontmatter.error || !frontmatter.editable) {
        return (
            <section className="notes-wysiwyg-frontmatter" aria-label="Frontmatter">
                <span className="notes-frontmatter-error" role="alert">
                    {frontmatter.error || 'Frontmatter is preserved as raw YAML'}
                </span>
            </section>
        );
    }

    return (
        <section className="notes-wysiwyg-frontmatter" aria-label="Frontmatter">
            <label className="notes-wysiwyg-frontmatter-field">
                <span>Aliases</span>
                <input
                    value={frontmatter.aliases.join(', ')}
                    onChange={event => props.onChange(updateWysiwygFrontmatter(frontmatter, {
                        aliases: parseAliasesInput(event.currentTarget.value),
                    }))}
                />
            </label>
            <label className="notes-wysiwyg-frontmatter-field">
                <span>Created</span>
                <input
                    value={frontmatter.created ?? ''}
                    onChange={event => props.onChange(updateWysiwygFrontmatter(frontmatter, {
                        created: event.currentTarget.value.trim() || null,
                    }))}
                />
            </label>
            <div className="notes-wysiwyg-frontmatter-tags">
                {frontmatter.tags.map(tag => (
                    <button
                        key={tag}
                        type="button"
                        className={`notes-tag-chip${props.activeTag === tag ? ' is-active' : ''}`}
                        onClick={() => props.onTagClick(props.activeTag === tag ? null : tag)}
                    >
                        {tag}
                    </button>
                ))}
            </div>
            <label className="notes-wysiwyg-frontmatter-field is-wide">
                <span>Tags</span>
                <input
                    value={frontmatter.tags.join(', ')}
                    onChange={event => props.onChange(updateWysiwygFrontmatter(frontmatter, {
                        tags: parseTagsInput(event.currentTarget.value),
                    }))}
                />
            </label>
        </section>
    );
}

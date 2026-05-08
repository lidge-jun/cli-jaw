export type WysiwygFixtureId =
    | 'basic'
    | 'headings'
    | 'links-safe'
    | 'links-unsafe'
    | 'relative-links'
    | 'images-safe'
    | 'images-unsafe'
    | 'task-list'
    | 'table-gfm'
    | 'nested-list-blockquote'
    | 'line-breaks'
    | 'reference-links'
    | 'escaped-markdown'
    | 'frontmatter'
    | 'frontmatter-wysiwyg-panel'
    | 'wikilinks-live-preview'
    | 'math-inline-block'
    | 'mermaid-valid'
    | 'mermaid-invalid'
    | 'fenced-code-ts'
    | 'fenced-code-unknown-language'
    | 'raw-html'
    | 'paste-html-img-onerror'
    | 'paste-html-javascript-link'
    | 'large-note-many-blocks'
    | 'conflict-local-remote'
    | 'ime-korean-japanese';

export type WysiwygFixtureBehavior = {
    id: WysiwygFixtureId;
    inputPath: string;
    expectedPath: string;
    requiresPreviewRenderer: boolean;
    securityCase?: boolean;
    pasteCase?: boolean;
    largeNoteCase?: boolean;
    conflictCase?: boolean;
    imeCase?: boolean;
    expectedUnsafeContentInert?: boolean;
};

function fixture(id: WysiwygFixtureId, behavior: Partial<WysiwygFixtureBehavior> = {}): WysiwygFixtureBehavior {
    return {
        id,
        inputPath: `tests/fixtures/manager-notes-wysiwyg/${id}.input.md`,
        expectedPath: `tests/fixtures/manager-notes-wysiwyg/${id}.expected.md`,
        requiresPreviewRenderer: true,
        ...behavior,
    };
}

export const REQUIRED_WYSIWYG_FIXTURES: readonly WysiwygFixtureBehavior[] = [
    fixture('basic'),
    fixture('headings'),
    fixture('links-safe'),
    fixture('links-unsafe', { securityCase: true, expectedUnsafeContentInert: true }),
    fixture('relative-links'),
    fixture('images-safe'),
    fixture('images-unsafe', { securityCase: true, expectedUnsafeContentInert: true }),
    fixture('task-list'),
    fixture('table-gfm'),
    fixture('nested-list-blockquote'),
    fixture('line-breaks'),
    fixture('reference-links'),
    fixture('escaped-markdown'),
    fixture('frontmatter'),
    fixture('frontmatter-wysiwyg-panel'),
    fixture('wikilinks-live-preview'),
    fixture('math-inline-block'),
    fixture('mermaid-valid'),
    fixture('mermaid-invalid'),
    fixture('fenced-code-ts'),
    fixture('fenced-code-unknown-language'),
    fixture('raw-html', { securityCase: true, expectedUnsafeContentInert: true }),
    fixture('paste-html-img-onerror', { securityCase: true, pasteCase: true, expectedUnsafeContentInert: true }),
    fixture('paste-html-javascript-link', { securityCase: true, pasteCase: true, expectedUnsafeContentInert: true }),
    fixture('large-note-many-blocks', { largeNoteCase: true }),
    fixture('conflict-local-remote', { conflictCase: true }),
    fixture('ime-korean-japanese', { imeCase: true }),
];

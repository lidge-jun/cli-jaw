import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { WYSIWYG_PREVIEW_RENDERER_POLICY } from '../../public/manager/src/notes/wysiwyg/wysiwyg-renderer-boundary';

const projectRoot = join(import.meta.dirname, '..', '..');

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

test('MarkdownPreview remains backed by the shared MarkdownRenderer', () => {
    const preview = read('public/manager/src/notes/MarkdownPreview.tsx');
    assert.equal(WYSIWYG_PREVIEW_RENDERER_POLICY.previewRenderer, 'MarkdownRenderer');
    assert.ok(preview.includes("import { MarkdownRenderer } from './rendering/MarkdownRenderer';"));
    assert.ok(preview.includes('<MarkdownRenderer markdown={props.markdown} />'));
});

test('WYSIWYG contract files do not duplicate preview renderer dependencies', () => {
    const wysiwygDir = join(projectRoot, 'public/manager/src/notes/wysiwyg');
    const source = readdirSync(wysiwygDir)
        .filter(file => file.endsWith('.ts') || file.endsWith('.tsx'))
        .map(file => read(`public/manager/src/notes/wysiwyg/${file}`))
        .join('\n');

    [
        "import { MarkdownRenderer",
        "from 'mermaid'",
        "from 'katex'",
        "from 'highlight.js'",
        'ReactMarkdown',
        'rehypeRaw',
        'rehypeKatex',
        'rehypeSanitize',
        'remarkMath',
        'dangerouslySetInnerHTML',
    ].forEach(forbidden => {
        assert.equal(source.includes(forbidden), false, `WYSIWYG contracts must not include ${forbidden}`);
    });
});

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
    assert.ok(preview.includes('markdown={props.markdown}'));
    assert.ok(preview.includes('outgoing={props.outgoing}'));
    assert.ok(preview.includes('onWikiLinkNavigate={props.onWikiLinkNavigate}'));
});

test('WYSIWYG contract files do not duplicate preview renderer dependencies', () => {
    const wysiwygDir = join(projectRoot, 'public/manager/src/notes/wysiwyg');
    const sources = readdirSync(wysiwygDir)
        .filter(file => file.endsWith('.ts') || file.endsWith('.tsx'))
        .map(file => ({
            file,
            source: read(`public/manager/src/notes/wysiwyg/${file}`),
        }));
    const source = sources.map(entry => entry.source).join('\n');

    [
        "import { MarkdownRenderer",
        "from 'mermaid'",
        "from 'highlight.js'",
        'ReactMarkdown',
        'rehypeRaw',
        'rehypeKatex',
        'rehypeSanitize',
        'dangerouslySetInnerHTML',
    ].forEach(forbidden => {
        assert.equal(source.includes(forbidden), false, `WYSIWYG contracts must not include ${forbidden}`);
    });

    sources.forEach(entry => {
        const importsKatex = entry.source.includes("from 'katex'");
        assert.equal(
            importsKatex,
            entry.file === 'milkdown-math.ts',
            'Only the local Milkdown math authoring plugin may import KaTeX directly',
        );

        const importsRemarkMath = entry.source.includes('remarkMath');
        assert.equal(
            importsRemarkMath,
            entry.file === 'milkdown-math.ts',
            'Only the local Milkdown math authoring plugin may import remark-math directly',
        );
    });
});

test('WYSIWYG owns wikilink and frontmatter live-preview behavior without preview renderer', () => {
    const editor = read('public/manager/src/notes/wysiwyg/MilkdownWysiwygEditor.tsx');
    const wikiPlugin = read('public/manager/src/notes/wysiwyg/milkdown-wikilink-plugin.ts');
    const wikiCompletion = read('public/manager/src/notes/wysiwyg/milkdown-wikilink-completion.ts');
    const frontmatter = read('public/manager/src/notes/wysiwyg/wysiwyg-frontmatter.ts');

    assert.ok(editor.includes('notesMilkdownWikiLinkPlugin'));
    assert.ok(editor.includes('notesMilkdownWikiLinkCompletionPlugin'));
    assert.ok(editor.includes('wikiCompletionRuntimeRef'));
    assert.ok(editor.includes('wikiCompletionRuntimeRef.current.notes = props.notes'));
    assert.equal(editor.includes('notesMilkdownWikiLinkCompletionPlugin({ notes: props.notes })'), false);
    assert.ok(editor.includes('splitWysiwygFrontmatter'));
    assert.ok(editor.includes('composeWysiwygFrontmatter'));
    assert.ok(wikiPlugin.includes('DecorationSet'));
    assert.ok(wikiPlugin.includes('resolveClientWikiLink'));
    assert.ok(wikiPlugin.includes("label.addEventListener('click'"));
    assert.ok(wikiPlugin.includes('focused: false'));
    assert.ok(wikiPlugin.includes('handleDOMEvents'));
    assert.ok(wikiCompletion.includes('PluginKey'));
    assert.ok(wikiCompletion.includes('Decoration.widget'));
    assert.ok(wikiCompletion.includes('getWikiLinkSuggestions'));
    assert.ok(wikiCompletion.includes("event.key === 'ArrowDown'"));
    assert.ok(wikiCompletion.includes("event.key === 'ArrowUp'"));
    assert.ok(wikiCompletion.includes("event.key === 'Enter'"));
    assert.ok(wikiCompletion.includes("event.key === 'Escape'"));
    assert.ok(frontmatter.includes('document.errors.length > 0'));
    assert.ok(frontmatter.includes('document.clone()'));
    assert.ok(frontmatter.includes("document.set('tags'"));
    assert.ok(frontmatter.includes("document.delete('alias'"));
});

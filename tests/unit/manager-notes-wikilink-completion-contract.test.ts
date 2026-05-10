import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { NotesNoteMetadata } from '../../public/manager/src/notes/notes-types';
import {
    formatWikiLinkCompletion,
    getWikiLinkCompletionRange,
    getWikiLinkSuggestions,
} from '../../public/manager/src/notes/wiki-link-suggestions';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

function note(path: string, title: string, overrides: Partial<NotesNoteMetadata> = {}): NotesNoteMetadata {
    return {
        path,
        title,
        aliases: [],
        tags: [],
        mtimeMs: 1,
        size: 1,
        revision: 'rev',
        ...overrides,
    };
}

test('wikilink completion range detects unmatched current-line [[ tokens', () => {
    assert.deepEqual(getWikiLinkCompletionRange('See [['), { from: 6, to: 6, query: '' });
    assert.deepEqual(getWikiLinkCompletionRange('See [[Proj'), { from: 6, to: 10, query: 'Proj' });
    assert.equal(getWikiLinkCompletionRange('See [[Done]]'), null);
    assert.equal(getWikiLinkCompletionRange('See [[Line\nbreak'), null);
    assert.equal(getWikiLinkCompletionRange('No token'), null);
    assert.equal(getWikiLinkCompletionRange('Escaped \\[['), null);
});

test('wikilink suggestions match title alias path stem and tag with stable insertion', () => {
    const notes = [
        note('Projects/Project Alpha.md', 'Project Alpha', { aliases: ['Alpha'], tags: ['planning'] }),
        note('Areas/Project Alpha.md', 'Project Alpha', { aliases: ['Duplicate'], tags: [] }),
        note('Archive/Beta Plan.md', 'Beta Plan', { aliases: ['Roadmap'], tags: ['strategy'] }),
    ];

    const titleMatches = getWikiLinkSuggestions(notes, 'project');
    assert.deepEqual(titleMatches.map(match => match.path), [
        'Areas/Project Alpha.md',
        'Projects/Project Alpha.md',
    ]);
    assert.equal(titleMatches[0]?.insertText, 'Areas/Project Alpha');
    assert.equal(formatWikiLinkCompletion(titleMatches[0]!), 'Areas/Project Alpha]]');

    const aliasMatches = getWikiLinkSuggestions(notes, 'road');
    assert.equal(aliasMatches[0]?.path, 'Archive/Beta Plan.md');
    assert.equal(aliasMatches[0]?.matchKind, 'alias');
    assert.equal(aliasMatches[0]?.insertText, 'Beta Plan');

    const tagMatches = getWikiLinkSuggestions(notes, 'strat');
    assert.equal(tagMatches[0]?.path, 'Archive/Beta Plan.md');
    assert.equal(tagMatches[0]?.matchKind, 'tag');

    assert.equal(getWikiLinkSuggestions(notes, '', 2).length, 2);
});

test('CodeMirror and WYSIWYG completion modules wire expected editor APIs', () => {
    const codeMirror = read('public/manager/src/notes/wiki-link-codemirror-completion.ts');
    const markdownEditor = read('public/manager/src/notes/MarkdownEditor.tsx');
    const wysiwyg = read('public/manager/src/notes/wysiwyg/milkdown-wikilink-completion.ts');
    const milkdownEditor = read('public/manager/src/notes/wysiwyg/MilkdownWysiwygEditor.tsx');

    assert.ok(codeMirror.includes("@codemirror/autocomplete"));
    assert.ok(codeMirror.includes('autocompletion'));
    assert.ok(codeMirror.includes('validFor'));
    assert.ok(markdownEditor.includes('wikiLinkCodeMirrorCompletion(props.notes)'));
    assert.ok(wysiwyg.includes('PluginKey'));
    assert.ok(wysiwyg.includes('Decoration.widget'));
    assert.ok(wysiwyg.includes('getWikiLinkSuggestions(runtime.notes'));
    assert.ok(wysiwyg.includes("event.key === 'ArrowDown'"));
    assert.ok(wysiwyg.includes("event.key === 'ArrowUp'"));
    assert.ok(wysiwyg.includes("event.key === 'Enter'"));
    assert.ok(wysiwyg.includes("event.key === 'Escape'"));
    assert.ok(milkdownEditor.includes('wikiCompletionRuntimeRef.current.notes = props.notes'));
});

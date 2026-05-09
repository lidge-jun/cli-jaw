import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const projectRoot = join(import.meta.dirname, '..', '..');

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

test('Milkdown WYSIWYG editor receives vault index wikilinks and tag frontmatter wiring', () => {
    const workspace = read('public/manager/src/notes/NotesWorkspace.tsx');
    const markdownEditor = read('public/manager/src/notes/MarkdownEditor.tsx');
    const milkdown = read('public/manager/src/notes/wysiwyg/MilkdownWysiwygEditor.tsx');

    assert.ok(workspace.includes('selectedOutgoingLinks'));
    assert.ok(workspace.includes('indexedNotes'));
    assert.ok(workspace.includes('onWikiLinkNavigate={props.onWikiLinkNavigate}'));
    assert.ok(markdownEditor.includes('outgoing={props.outgoing}'));
    assert.ok(markdownEditor.includes('notes={props.notes}'));
    assert.ok(milkdown.includes('notesMilkdownWikiLinkPlugin'));
    assert.ok(milkdown.includes('WysiwygFrontmatterPanel'));
});

test('WYSIWYG wikilink plugin protects code and handles resolved navigation', () => {
    const plugin = read('public/manager/src/notes/wysiwyg/milkdown-wikilink-plugin.ts');

    assert.ok(plugin.includes("node.type.name === 'code_block'"));
    assert.ok(plugin.includes("mark.type.name === 'inlineCode'"));
    assert.ok(plugin.includes('runtime.onNavigate(link.resolvedPath!)'));
    assert.ok(plugin.includes('notes-wikilink-live'));
    assert.ok(plugin.includes('is-broken'));
    assert.ok(plugin.includes('selectionSet'));
    assert.ok(plugin.includes('data-notes-wiki-hidden'));
    assert.ok(plugin.includes("label.addEventListener('click'"));
});

test('WYSIWYG wikilink plugin decorates newly typed links before outgoing index refresh', () => {
    const plugin = read('public/manager/src/notes/wysiwyg/milkdown-wikilink-plugin.ts');

    assert.equal(plugin.includes('if (lookup.size === 0) return DecorationSet.empty'), false);
    assert.ok(plugin.includes('fallbackLink(raw, runtime, from)'));
    assert.ok(plugin.includes('runtime.notes.filter'));
    assert.ok(plugin.includes("status: 'missing'"));
    assert.ok(plugin.includes("status: 'resolved'"));
});

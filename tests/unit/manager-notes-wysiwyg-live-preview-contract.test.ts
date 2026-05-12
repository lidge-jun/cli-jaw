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
    assert.ok(plugin.includes('type WikiLinkPluginState'));
    assert.ok(plugin.includes('shouldHideWikiLinkSource'));
    assert.ok(plugin.includes('handleDOMEvents'));
    assert.ok(plugin.includes('focused: true'));
    assert.ok(plugin.includes('focused: false'));
});

test('WYSIWYG wikilink plugin decorates newly typed links before outgoing index refresh', () => {
    const plugin = read('public/manager/src/notes/wysiwyg/milkdown-wikilink-plugin.ts');

    assert.equal(plugin.includes('if (lookup.size === 0) return DecorationSet.empty'), false);
    assert.ok(plugin.includes('resolveClientWikiLink(raw, runtime.outgoing, runtime.notes, from)'));
    assert.equal(plugin.includes('function fallbackLink'), false);
    assert.equal(plugin.includes('function noteStem'), false);
    assert.equal(plugin.includes('function invalidTarget'), false);
});

test('WYSIWYG wikilink plugin hides source while editor is blurred', () => {
    const plugin = read('public/manager/src/notes/wysiwyg/milkdown-wikilink-plugin.ts');
    const editor = read('public/manager/src/notes/wysiwyg/MilkdownWysiwygEditor.tsx');

    assert.ok(plugin.includes('buildWikiLinkDecorations(state, runtime, false)'));
    assert.ok(plugin.includes('buildWikiLinkDecorations(newState, runtime, focused)'));
    assert.ok(plugin.includes('if (!focused) return true;'));
    assert.ok(plugin.includes("view.state.tr.setMeta(notesWikiLinkPluginKey, { focused: false, refresh: true })"));
    assert.ok(editor.includes('refreshWikiLinkPluginsAfterFrame'));
    assert.ok(editor.includes('requestAnimationFrame(() => refreshWikiLinkPlugins())'));
});

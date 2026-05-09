import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(import.meta.dirname, '../..');

function read(relPath: string): string {
    return readFileSync(join(projectRoot, relPath), 'utf8');
}

test('render.ts remains a small public facade after render module split', () => {
    const facade = read('public/js/render.ts');
    const lines = facade.trim().split('\n');

    assert.ok(lines.length <= 80, 'render facade should stay small');
    assert.ok(facade.includes("export { renderMarkdown } from './render/markdown.js';"));
    assert.ok(facade.includes("export { sanitizeHtml } from './render/sanitize.js';"));
    assert.ok(facade.includes("export { linkifyFilePaths } from './render/file-links.js';"));
    assert.ok(facade.includes("renderMermaidBlocks"));
    assert.ok(facade.includes("releaseMermaidNodes"));
    assert.ok(facade.includes("rerenderMermaidDiagrams"));
    assert.ok(facade.includes("prewarmMermaid"));
});

test('render modules keep markdown, mermaid, sanitizer, SVG, and post-render responsibilities separate', () => {
    assert.match(read('public/js/render/markdown.ts'), /export function renderMarkdown/);
    assert.match(read('public/js/render/mermaid.ts'), /export async function renderMermaidBlocks/);
    assert.match(read('public/js/render/sanitize.ts'), /export function sanitizeHtml/);
    assert.match(read('public/js/render/svg-actions.ts'), /export function bindDiagramZoom/);
    assert.match(read('public/js/render/post-render.ts'), /export function schedulePostRender/);
    assert.match(read('public/js/render/highlight.ts'), /export function rehighlightAll/);
});

test('post-render scheduler depends on highlight module, not markdown, to avoid a cycle', () => {
    const postRender = read('public/js/render/post-render.ts');
    assert.ok(postRender.includes("import { rehighlightAll } from './highlight.js';"));
    assert.ok(!postRender.includes("from './markdown.js'"));
});


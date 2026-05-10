import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeStrictPropertyAccess } from './source-normalize';

// Phase 127 (#127) mermaid render latency — source-string contract.
// Avoids importing render modules directly (they depend on browser globals/libs).

const renderSrc = normalizeStrictPropertyAccess([
    '../../public/js/render.ts',
    '../../public/js/render/markdown.ts',
    '../../public/js/render/mermaid.ts',
    '../../public/js/render/mermaid-preprocess.ts',
    '../../public/js/render/sanitize.ts',
    '../../public/js/render/svg-actions.ts',
].map(file => readFileSync(join(import.meta.dirname, file), 'utf8')).join('\n'));

const preprocessSrc = readFileSync(
    join(import.meta.dirname, '../../public/js/render/mermaid-preprocess.ts'), 'utf8',
);

const notesMermaidSrc = readFileSync(
    join(import.meta.dirname, '../../public/manager/src/notes/rendering/MermaidBlock.tsx'), 'utf8',
);

test('F1: mermaid fence emits skeleton + URI-encoded source attribute', () => {
    assert.ok(renderSrc.includes('mermaid-skeleton'),
        'renderer.code should emit <div class="mermaid-skeleton">');
    assert.ok(renderSrc.includes('mermaid-skeleton-spinner'),
        'skeleton should include a spinner element');
    assert.ok(renderSrc.includes('data-mermaid-code-raw'),
        'fence should store encoded raw source in data-mermaid-code-raw');
    assert.ok(renderSrc.includes('encodeURIComponent(text)'),
        'raw text must be URL-encoded for attribute safety');
    assert.ok(!/\${escapeHtml\(text\)}<\/div>/.test(renderSrc),
        'the old raw-text fallback (escapeHtml + direct closing div) must be removed');
});

test('F1: renderSingleMermaidImpl reads source from dataset first', () => {
    const idx = renderSrc.indexOf('async function renderSingleMermaidImpl');
    assert.ok(idx >= 0, 'renderSingleMermaidImpl must exist');
    const block = renderSrc.slice(idx, idx + 1500);
    assert.ok(block.includes('el.dataset.mermaidCodeRaw'),
        'must read encoded source from dataset.mermaidCodeRaw');
    assert.ok(block.includes('decodeURIComponent'),
        'must decode the stored raw source');
    assert.ok(block.includes('el.dataset.mermaidCode = code'),
        'must preserve the canonical mermaidCode dataset field for copy button');
});

test('F9: renderSingleMermaidImpl skips detached nodes instead of updating stale DOM', () => {
    const idx = renderSrc.indexOf('async function renderSingleMermaidImpl');
    assert.ok(idx >= 0, 'renderSingleMermaidImpl must exist');
    const block = renderSrc.slice(idx, idx + 2200);

    assert.ok(block.includes('!el.isConnected'),
        'renderSingleMermaidImpl must guard detached elements');
    assert.ok(block.includes('delete el.dataset.mermaidQueued'),
        'detached guard must clear queued state on the stale element');

    const renderIdx = block.indexOf('await mm.render');
    const writeIdx = block.indexOf('el.innerHTML = sanitizeMermaidSvg(svg)');
    const guardIdx = block.indexOf('if (!el.isConnected)', renderIdx);
    assert.ok(renderIdx >= 0, 'must call mm.render in renderSingleMermaidImpl');
    assert.ok(writeIdx >= 0, 'must write sanitized SVG into element');
    assert.ok(guardIdx > renderIdx,
        'must check detached state after async mm.render resolves');
    assert.ok(guardIdx < writeIdx,
        'post-render detached guard must run before writing innerHTML');
});

test('F5: renderMermaidBlocks is exported and accepts immediate option', () => {
    assert.ok(renderSrc.match(/export async function renderMermaidBlocks\(/),
        'renderMermaidBlocks must be exported');
    assert.ok(renderSrc.includes('opts: { immediate?: boolean }'),
        'must accept immediate option');
    assert.ok(renderSrc.includes('getBoundingClientRect()'),
        'immediate mode should use getBoundingClientRect for viewport check');
});

test('F2: prewarmMermaid is exported with idle callback fallback', () => {
    assert.ok(renderSrc.match(/export function prewarmMermaid\(\): void/),
        'prewarmMermaid must be exported with void return type');
    const idx = renderSrc.indexOf('export function prewarmMermaid');
    const block = renderSrc.slice(idx, idx + 900);
    assert.ok(block.includes('requestIdleCallback'),
        'should use requestIdleCallback when available');
    assert.ok(block.includes('setTimeout'),
        'should fall back to setTimeout when requestIdleCallback is missing');
});

test('F6: mermaidQueue has .catch tail to survive rejections', () => {
    const idx = renderSrc.indexOf('function renderSingleMermaid(');
    assert.ok(idx >= 0);
    const block = renderSrc.slice(idx, idx + 900);
    assert.ok(/\.catch\(/.test(block),
        'renderSingleMermaid must attach .catch so one failure does not block the queue');
});

test('N2: data-mermaid-queued guard prevents duplicate enqueueing', () => {
    const idx = renderSrc.indexOf('function renderSingleMermaid(');
    const block = renderSrc.slice(idx, idx + 900);
    assert.ok(block.includes("el.dataset.mermaidQueued === '1'"),
        'renderSingleMermaid must guard with dataset.mermaidQueued');
    assert.ok(block.includes("el.dataset.mermaidQueued = '1'"),
        'guard flag must be set synchronously before enqueue');

    // renderMermaidBlocks should also skip already-queued elements
    const rmbIdx = renderSrc.indexOf('export async function renderMermaidBlocks');
    const rmbBlock = renderSrc.slice(rmbIdx, rmbIdx + 1500);
    assert.ok(rmbBlock.includes("el.dataset.mermaidQueued === '1'"),
        'renderMermaidBlocks must skip elements already queued');
});

test('S3: sanitizer ADD_ATTR whitelists data-mermaid-code-raw', () => {
    const addAttrMatch = renderSrc.match(/ADD_ATTR:\s*\[([^\]]+)\]/);
    assert.ok(addAttrMatch, 'sanitizeHtml must have ADD_ATTR config');
    assert.ok(addAttrMatch[1].includes("'data-mermaid-code-raw'"),
        'data-mermaid-code-raw must be in the sanitizer allowlist');
});

test('D1: rendered Mermaid diagrams restore expand control and binding', () => {
    const actionIdx = renderSrc.indexOf('function appendMermaidActionBtns');
    assert.ok(actionIdx >= 0, 'appendMermaidActionBtns must exist');
    const actionBlock = renderSrc.slice(actionIdx, actionIdx + 1200);

    assert.ok(actionBlock.includes("zoomBtn.className = 'mermaid-zoom-btn'"),
        'Mermaid action helper must create a visible zoom button');
    assert.ok(actionBlock.includes("zoomBtn.ariaLabel = 'Expand diagram'"),
        'Mermaid zoom button must be accessible');
    assert.ok(actionBlock.includes('el.appendChild(zoomBtn)'),
        'Mermaid zoom button must be appended before copy/save controls');

    const renderIdx = renderSrc.indexOf('async function renderSingleMermaidImpl');
    const renderBlock = renderSrc.slice(renderIdx, renderIdx + 1800);
    assert.ok(renderBlock.includes('appendMermaidActionBtns(el)'),
        'Mermaid render must append action controls after sanitized SVG write');
    assert.ok(renderBlock.includes('bindDiagramZoom(el)'),
        'Mermaid render must bind zoom after async render completes');
});

test('D1: shared zoom binder supports Mermaid without routing widget iframes through sanitizer overlay', () => {
    const bindIdx = renderSrc.indexOf('export function bindDiagramZoom');
    assert.ok(bindIdx >= 0, 'bindDiagramZoom must exist');
    const bindBlock = renderSrc.slice(bindIdx, bindIdx + 1200);

    assert.ok(bindBlock.includes("'.diagram-zoom-btn, .mermaid-zoom-btn'"),
        'shared zoom binder must scan both SVG and Mermaid zoom buttons');
    assert.ok(bindBlock.includes("btn.closest('.diagram-widget')"),
        'shared zoom binder must skip widget iframe zoom buttons');
    assert.ok(bindBlock.includes("btn.closest('.diagram-container')"),
        'shared zoom binder must find inline SVG containers');
    assert.ok(bindBlock.includes("btn.closest('.mermaid-container')"),
        'shared zoom binder must find Mermaid containers');
    assert.ok(bindBlock.includes("'mermaid' : 'inline-svg'"),
        'shared zoom binder must preserve overlay kind for SVG styling scope');
    assert.ok(bindBlock.includes('.mermaid-copy-btn, .mermaid-save-btn'),
        'overlay clone must remove Mermaid action buttons before rendering overlay');
});

// ── Mermaid preprocessor contract tests (#194) ──

test('PP1: preprocessMermaid handles CRLF normalization, trailing semicolons, and node ID cleanup', () => {
    assert.ok(preprocessSrc.includes('export function preprocessMermaid'),
        'preprocessMermaid must be exported');
    assert.ok(preprocessSrc.includes('\\r\\n'),
        'preprocessMermaid must handle CRLF');
    assert.ok(preprocessSrc.includes('/;\\s*$/gm'),
        'preprocessMermaid must strip trailing semicolons');
    assert.ok(preprocessSrc.includes('normalizeFlowchartNodeIds'),
        'preprocessMermaid must normalize node IDs for flowchart/graph diagrams');
    assert.ok(preprocessSrc.includes('RESERVED_NODE_IDS'),
        'preprocessor must handle reserved keywords as node IDs');
});

test('PP2: sanitizeMermaidForRetry implements bracket-depth label quoting', () => {
    assert.ok(preprocessSrc.includes('export function sanitizeMermaidForRetry'),
        'sanitizeMermaidForRetry must be exported');
    assert.ok(preprocessSrc.includes('flowchart|graph'),
        'sanitizeMermaidForRetry must only apply to flowchart/graph diagrams');
    assert.ok(preprocessSrc.includes('depth'),
        'sanitizeMermaidForRetry must use bracket-depth tracking');
    assert.ok(preprocessSrc.includes('#quot;'),
        'sanitizeMermaidForRetry must escape double quotes in labels');
});

test('PP3: renderSingleMermaidImpl uses preprocessMermaid before render', () => {
    const idx = renderSrc.indexOf('async function renderSingleMermaidImpl');
    assert.ok(idx >= 0);
    const block = renderSrc.slice(idx, idx + 2500);
    assert.ok(block.includes('preprocessMermaid'),
        'renderSingleMermaidImpl must call preprocessMermaid on raw code');
});

test('PP4: renderSingleMermaidImpl retries with sanitizeMermaidForRetry on failure', () => {
    const idx = renderSrc.indexOf('async function renderSingleMermaidImpl');
    assert.ok(idx >= 0);
    const block = renderSrc.slice(idx, idx + 2500);
    assert.ok(block.includes('sanitizeMermaidForRetry'),
        'renderSingleMermaidImpl must call sanitizeMermaidForRetry on first render failure');
    assert.ok(block.includes('-retry'),
        'retry render must use a distinct mermaid ID to avoid registry collision');
});

test('PP5: rerenderMermaidDiagrams uses preprocess + retry path', () => {
    const idx = renderSrc.indexOf('export async function rerenderMermaidDiagrams');
    assert.ok(idx >= 0);
    const block = renderSrc.slice(idx, idx + 2000);
    assert.ok(block.includes('preprocessMermaid'),
        'rerenderMermaidDiagrams must preprocess code');
    assert.ok(block.includes('sanitizeMermaidForRetry'),
        'rerenderMermaidDiagrams must retry with sanitized code on failure');
});

test('PP6: MermaidBlock.tsx imports from shared preprocessor and uses retry logic', () => {
    assert.ok(notesMermaidSrc.includes('mermaid-preprocess'),
        'MermaidBlock must import from shared mermaid-preprocess module');
    assert.ok(notesMermaidSrc.includes('preprocessMermaid'),
        'MermaidBlock must call preprocessMermaid');
    assert.ok(notesMermaidSrc.includes('sanitizeMermaidForRetry'),
        'MermaidBlock must call sanitizeMermaidForRetry on first render failure');
    assert.ok(notesMermaidSrc.includes('-retry'),
        'MermaidBlock retry must use a distinct mermaid ID');
});

test('PP7: mermaid.ts imports from mermaid-preprocess', () => {
    assert.ok(renderSrc.includes("from './mermaid-preprocess"),
        'mermaid.ts must import preprocessMermaid and sanitizeMermaidForRetry');
});

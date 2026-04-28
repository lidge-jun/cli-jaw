import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const uiSrc = readFileSync(join(import.meta.dirname, '../../public/js/ui.ts'), 'utf8');

function functionBlock(source: string, signature: string): string {
    const start = source.indexOf(signature);
    assert.ok(start >= 0, `${signature} must exist`);
    const open = source.indexOf('{', start);
    assert.ok(open >= 0, `${signature} must have a body`);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        if (depth === 0) return source.slice(start, i + 1);
    }
    assert.fail(`${signature} body must close`);
}

test('ProcessBlock DOM has a single-owner selector covering canonical and legacy blocks', () => {
    const block = uiSrc.slice(
        uiSrc.indexOf('const TOOL_BLOCK_SELECTOR'),
        uiSrc.indexOf('function agentBody'),
    );

    assert.ok(block.includes('TOOL_BLOCK_SELECTOR'), 'TOOL_BLOCK_SELECTOR must exist');
    assert.ok(block.includes(':scope > .process-block'), 'selector must include canonical process blocks');
    assert.ok(block.includes(':scope > .tool-group'), 'selector must include legacy tool groups');
    assert.ok(block.includes(':scope > .msg-content > .process-block'),
        'selector must detect nested process blocks inside msg-content');
    assert.ok(block.includes(':scope > .msg-content > .tool-group'),
        'selector must detect nested legacy tool groups inside msg-content');
});

test('ProcessBlock DOM helpers exist without exporting test-only APIs', () => {
    assert.ok(uiSrc.includes('function normalizeAgentToolBlocks(agentMsg: HTMLElement): void'),
        'normalizeAgentToolBlocks helper must exist');
    assert.ok(uiSrc.includes('function hasAgentToolBlock(agentMsg: HTMLElement): boolean'),
        'hasAgentToolBlock helper must exist');
    assert.ok(!uiSrc.includes('export function normalizeAgentToolBlocks'),
        'normalization helper should remain private');
    assert.ok(!uiSrc.includes('export function hasAgentToolBlock'),
        'presence helper should remain private');
});

test('finalizeAgent preserves canonical tool ownership', () => {
    const block = functionBlock(uiSrc, 'export function finalizeAgent');

    assert.ok(block.includes('hasAgentToolBlock(state.currentAgentDiv)'),
        'finalizeAgent must consider existing DOM tool blocks, not only state.currentProcessBlock');
    assert.ok(!block.includes('const hadProcessBlock = !!state.currentProcessBlock'),
        'finalizeAgent must not rely only on state.currentProcessBlock');
    assert.ok(!block.includes('content.innerHTML = toolHtml + renderMarkdown(finalText)'),
        'finalizeAgent must not write tool HTML inside msg-content');
    assert.ok(block.includes("insertAdjacentHTML(\n                    'beforebegin'"),
        'static tool HTML must be inserted before msg-content');
    assert.ok(block.includes('normalizeAgentToolBlocks(state.currentAgentDiv)'),
        'finalizeAgent must normalize after static insertion');
});

test('active hydration and live process steps normalize before block creation', () => {
    const hydrateBlock = functionBlock(uiSrc, 'export function hydrateActiveRun');
    const showBlock = functionBlock(uiSrc, 'export function showProcessStep');

    assert.ok(hydrateBlock.includes('normalizeAgentToolBlocks(state.currentAgentDiv)'),
        'hydrateActiveRun must normalize existing tool blocks');
    assert.ok(hydrateBlock.indexOf('normalizeAgentToolBlocks(state.currentAgentDiv)')
        < hydrateBlock.indexOf('createProcessBlock(body)'),
        'hydrateActiveRun must normalize before creating a process block');
    assert.ok(showBlock.includes('normalizeAgentToolBlocks(agentDiv)'),
        'showProcessStep must normalize before creating or reusing a process block');
    assert.ok(showBlock.indexOf('normalizeAgentToolBlocks(agentDiv)')
        < showBlock.indexOf('createProcessBlock(body)'),
        'showProcessStep must normalize before createProcessBlock');
});

test('virtual-scroll serialization normalizes agent messages first', () => {
    const addBlock = functionBlock(uiSrc, 'export function addMessage');

    assert.ok(addBlock.includes("if (div.classList.contains('msg-agent')) normalizeAgentToolBlocks(div);"),
        'live append path must normalize agent messages before appendLiveItem');
    assert.ok(addBlock.indexOf("if (div.classList.contains('msg-agent')) normalizeAgentToolBlocks(div);")
        < addBlock.indexOf('vs.appendLiveItem(div)'),
        'normalization must happen before vs.appendLiveItem(div)');
    assert.ok(addBlock.includes("if (el.classList.contains('msg-agent')) normalizeAgentToolBlocks(el as HTMLElement);"),
        'threshold promotion must normalize agent DOM before serializing outerHTML');
    assert.ok(addBlock.indexOf("if (el.classList.contains('msg-agent')) normalizeAgentToolBlocks(el as HTMLElement);")
        < addBlock.indexOf('vs.addItem(generateId(), el.outerHTML)'),
        'normalization must happen before vs.addItem(... el.outerHTML)');
});

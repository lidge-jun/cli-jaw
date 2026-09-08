import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCursorModelList, splitCursorModelId } from '../../src/agent/cursor-model-inventory.ts';
import { parseGrokModelList } from '../../src/agent/grok-models.ts';

// Shaped after real `cursor-agent --list-models` output.
const CURSOR_OUTPUT = [
    'Available models',
    '',
    'auto - Auto (default)',
    'composer-2.5 - Composer 2.5',
    'composer-2.5-fast - Composer 2.5 Fast',
    'claude-opus-5-low - Claude Opus 5 1M Low',
    'claude-opus-5-high - Claude Opus 5 1M',
    'claude-opus-5-max-fast - Claude Opus 5 1M Max Fast',
    'gpt-5.5-extra-high - GPT-5.5 Extra High',
    'gpt-5.5-extra-high-fast - GPT-5.5 Extra High Fast',
    'cursor-grok-4.6-high - Cursor Grok 4.6',
    'cursor-grok-4.6-xhigh-fast - Cursor Grok 4.6 Extra High Fast',
    '',
    "Tip: use --model <id> to switch.",
].join('\n');

// ─── Cursor id splitting ─────────────────────────────

test('CI-001: strips the effort suffix to recover the base model', () => {
    assert.deepEqual(splitCursorModelId('claude-opus-5-low'), { base: 'claude-opus-5', effort: 'low' });
    assert.deepEqual(splitCursorModelId('claude-opus-5-max-fast'), { base: 'claude-opus-5', effort: 'max-fast' });
});

test('CI-002: reads Cursor spelling of xhigh', () => {
    assert.deepEqual(splitCursorModelId('gpt-5.5-extra-high'), { base: 'gpt-5.5', effort: 'xhigh' });
    assert.deepEqual(splitCursorModelId('gpt-5.5-extra-high-fast'), { base: 'gpt-5.5', effort: 'xhigh-fast' });
});

test('CI-003: drops the account prefix so the base matches the picker vocabulary', () => {
    // Leaving it on would make resolveCursorModelVariant build cursor-cursor-grok-...
    assert.deepEqual(splitCursorModelId('cursor-grok-4.6-high'), { base: 'grok-4.6', effort: 'high' });
});

test('CI-004: composer encodes speed, not a ladder rung', () => {
    assert.deepEqual(splitCursorModelId('composer-2.5'), { base: 'composer-2.5' });
    assert.deepEqual(splitCursorModelId('composer-2.5-fast'), { base: 'composer-2.5', effort: 'medium-fast' });
});

test('CI-005: an id with no suffix is its own base', () => {
    assert.deepEqual(splitCursorModelId('auto'), { base: 'auto' });
});

// ─── Cursor listing ──────────────────────────────────

test('CI-006: keeps every wire id verbatim', () => {
    const inventory = parseCursorModelList(CURSOR_OUTPUT)!;
    assert.ok(inventory.modelIds.includes('cursor-grok-4.6-high'));
    assert.ok(inventory.modelIds.includes('gpt-5.5-extra-high-fast'));
    assert.equal(inventory.modelIds.includes('Available'), false);
});

test('CI-007: derives base models instead of listing them separately', () => {
    const inventory = parseCursorModelList(CURSOR_OUTPUT)!;
    assert.deepEqual(inventory.baseModels, [
        'auto', 'composer-2.5', 'claude-opus-5', 'gpt-5.5', 'grok-4.6',
    ]);
});

test('CI-008: collects observed rungs per base, in ladder order', () => {
    const inventory = parseCursorModelList(CURSOR_OUTPUT)!;
    assert.deepEqual(inventory.effortsByModel['claude-opus-5'], ['low', 'high', 'max-fast']);
    assert.deepEqual(inventory.effortsByModel['gpt-5.5'], ['xhigh', 'xhigh-fast']);
});

test('CI-009: the header and the trailing tip are not models', () => {
    const inventory = parseCursorModelList(CURSOR_OUTPUT)!;
    assert.equal(inventory.baseModels.some(m => m.startsWith('Tip')), false);
});

test('CI-010: unrecognized output answers null so the static list stands', () => {
    assert.equal(parseCursorModelList('command not found'), null);
    assert.equal(parseCursorModelList(''), null);
});

// ─── Grok listing ────────────────────────────────────

const GROK_OUTPUT = [
    'You are logged in with grok.com.',
    '',
    'Default model: grok-4.6',
    '',
    'Available models:',
    '  * grok-4.6 (default)',
    '  - grok-4.5',
    '  - ocx-gpt-6-astra',
].join('\n');

test('CI-011: reads the bullet list, including routed ids', () => {
    const inventory = parseGrokModelList(GROK_OUTPUT)!;
    assert.deepEqual(inventory.models, ['grok-4.6', 'grok-4.5', 'ocx-gpt-6-astra']);
});

test('CI-012: the starred row names the default', () => {
    assert.equal(parseGrokModelList(GROK_OUTPUT)!.defaultModel, 'grok-4.6');
});

test('CI-013: a listing with no star falls back to the header', () => {
    const inventory = parseGrokModelList('Default model: grok-4.5\n  - grok-4.5\n  - grok-4.6')!;
    assert.equal(inventory.defaultModel, 'grok-4.5');
});

test('CI-014: a header naming a model the account does not serve is ignored', () => {
    const inventory = parseGrokModelList('Default model: grok-9\n  - grok-4.6')!;
    assert.equal(inventory.defaultModel, undefined);
    assert.deepEqual(inventory.models, ['grok-4.6']);
});

test('CI-015: unrecognized output answers null', () => {
    assert.equal(parseGrokModelList('not logged in'), null);
});

test('CI-016: a bare -fast is the fast form of its base, not a separate model', () => {
    // gpt-5.3-codex-fast is gpt-5.3-codex at speed; treating it as its own base
    // put a duplicate in the picker.
    assert.deepEqual(splitCursorModelId('gpt-5.3-codex-fast'), { base: 'gpt-5.3-codex', effort: 'medium-fast' });
});

test('CI-017: -thinking is part of the base, not a rung', () => {
    assert.deepEqual(
        splitCursorModelId('claude-opus-5-thinking-xhigh'),
        { base: 'claude-opus-5-thinking', effort: 'xhigh' },
    );
});

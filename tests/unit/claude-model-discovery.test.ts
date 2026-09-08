import test from 'node:test';
import assert from 'node:assert/strict';
import {
    claudeCatalogToChoices,
    createClaudeCatalogScanner,
    parseClaudeBundleCatalog,
} from '../../src/cli/claude-model-discovery.ts';

/**
 * Shaped after the real Claude Code 2.1.263 bundle: a provider mapping row per
 * model, one short-alias table, and a `<id>[1m]` literal for each model whose 1M
 * window the CLI enables.
 */
const BUNDLE = [
    '{first_party:"claude-opus-5",bedrock:"us.anthropic.claude-opus-5",vertex:"claude-opus-5"}',
    '{first_party:"claude-sonnet-5",bedrock:"us.anthropic.claude-sonnet-5"}',
    '{first_party:"claude-fable-5-1",bedrock:"us.anthropic.claude-fable-5-1"}',
    '{first_party:"claude-haiku-4-5-20251001",bedrock:"us.anthropic.claude-haiku-4-5-20251001-v1:0"}',
    '{first_party:"claude-3-5-sonnet-20241022",bedrock:"us.anthropic.claude-3-5-sonnet-20241022-v2:0"}',
    '{first_party:"claude-mythos-5",bedrock:"anthropic.claude-mythos-5"}',
    '{fable:"claude-fable-5-1",opus:"claude-opus-5",sonnet:"claude-sonnet-5",haiku:"claude-haiku-4-5"}',
    'var x=["claude-opus-5[1m]","claude-sonnet-5[1m]"]',
].join(';');

test('CMD-001: parses first-party ids, the alias table and 1M variants', () => {
    const catalog = parseClaudeBundleCatalog([BUNDLE]);
    assert.ok(catalog.firstParty.includes('claude-opus-5'));
    assert.ok(catalog.firstParty.includes('claude-sonnet-5'));
    assert.ok(catalog.firstParty.includes('claude-fable-5-1'));
    assert.deepEqual(catalog.aliases, {
        fable: 'claude-fable-5-1', opus: 'claude-opus-5',
        sonnet: 'claude-sonnet-5', haiku: 'claude-haiku-4-5',
    });
    assert.deepEqual(catalog.oneMillion, ['claude-opus-5', 'claude-sonnet-5']);
});

test('CMD-002: drops compatibility-only legacy generations', () => {
    const catalog = parseClaudeBundleCatalog([BUNDLE]);
    assert.equal(catalog.firstParty.includes('claude-3-5-sonnet-20241022'), false);
});

test('CMD-003: drops non-coding mythos family', () => {
    const catalog = parseClaudeBundleCatalog([BUNDLE]);
    assert.equal(catalog.firstParty.includes('claude-mythos-5'), false);
});

test('CMD-004: derives [1m] variants instead of listing them by hand', () => {
    const choices = claudeCatalogToChoices(parseClaudeBundleCatalog([BUNDLE]));
    assert.ok(choices.includes('claude-opus-5[1m]'));
    assert.ok(choices.includes('claude-sonnet-5[1m]'));
    // Haiku stays at 200k, so the bundle carries no literal and no variant is
    // invented for it.
    assert.equal(choices.some(c => c.startsWith('claude-haiku') && c.endsWith('[1m]')), false);
});

test('CMD-005: aliases lead the choice list', () => {
    const choices = claudeCatalogToChoices(parseClaudeBundleCatalog([BUNDLE]));
    assert.deepEqual(choices.slice(0, 4), ['opus', 'sonnet', 'haiku', 'fable']);
});

test('CMD-006: a variant is only offered for a model that is itself offered', () => {
    const catalog = parseClaudeBundleCatalog([
        '{first_party:"claude-opus-5"};"claude-3-5-sonnet-20241022[1m]"',
    ]);
    assert.deepEqual(catalog.oneMillion, []);
    assert.deepEqual(claudeCatalogToChoices(catalog), ['claude-opus-5']);
});

test('CMD-007: an unrecognized bundle yields an empty catalog rather than junk', () => {
    const catalog = parseClaudeBundleCatalog(['no model table here at all']);
    assert.deepEqual(catalog.firstParty, []);
    assert.deepEqual(catalog.aliases, {});
    assert.deepEqual(claudeCatalogToChoices(catalog), []);
});

test('CMD-008: overlapping chunks recover a match split across a boundary', () => {
    const split = 'prefix{first_party:"claude-opus-5",bedrock:"x"}suffix';
    const cut = split.indexOf('opus');
    const scanner = createClaudeCatalogScanner();
    const head = split.slice(0, cut);
    scanner.push(head);
    // Mirrors readClaudeBundleCatalog: the next push repeats the tail of the last.
    scanner.push(head.slice(-512) + split.slice(cut));
    assert.deepEqual(scanner.result().firstParty, ['claude-opus-5']);
});

test('CMD-009: duplicate rows across chunks collapse to one entry', () => {
    const row = '{first_party:"claude-opus-5",bedrock:"x"}';
    assert.deepEqual(parseClaudeBundleCatalog([row, row, row]).firstParty, ['claude-opus-5']);
});

test('CMD-010: the first alias table wins when the bundle carries several', () => {
    const catalog = parseClaudeBundleCatalog([
        '{fable:"claude-fable-5-1",opus:"claude-opus-5",sonnet:"claude-sonnet-5",haiku:"claude-haiku-4-5"}',
        '{fable:"stale",opus:"stale",sonnet:"stale",haiku:"stale"}',
    ]);
    assert.equal(catalog.aliases['opus'], 'claude-opus-5');
});

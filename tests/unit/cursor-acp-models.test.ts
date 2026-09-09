import test from 'node:test';
import assert from 'node:assert/strict';
import { cursorAcpModel } from '../../src/agent/cursor-acp-models.ts';
import { CURSOR_MODEL_IDS, CURSOR_REGISTRY_MODELS } from '../../src/agent/cursor-runtime.ts';

/**
 * The advertised set as cursor-agent 2026.09.08-6caf4ff returns it from
 * `session/new`, recorded verbatim. Every id is a bare base: no effort rung is
 * part of a model id there, and Grok carries no account prefix. That shape is
 * what makes an exact rewrite safe, so the fixture is the evidence, not a guess.
 */
const ADVERTISED = ['default', 'grok-4.6', 'composer-2.5', 'claude-opus-5', 'claude-opus-4-8',
    'gpt-5.6-sol', 'gpt-5.5', 'claude-fable-5-1', 'claude-fable-5', 'grok-4.5', 'gemini-3.8-flash',
    'gemini-3.7-flash', 'muse-spark-1.3', 'gpt-5.6-terra', 'claude-sonnet-5', 'claude-sonnet-4-6',
    'gpt-5.3-codex', 'claude-opus-4-7', 'gpt-5.4', 'claude-opus-4-6', 'claude-opus-4-5', 'gpt-5.2',
    'gpt-5.6-luna', 'gemini-3.6-flash', 'gemini-3.1-pro', 'gpt-5.4-mini', 'gpt-5.4-nano',
    'claude-haiku-4-5', 'claude-sonnet-4-5', 'gpt-5.1', 'gemini-3-flash', 'gemini-3.5-flash',
    'claude-sonnet-4', 'gpt-5-mini', 'gemini-2.5-flash', 'kimi-k3', 'kimi-k2.7-code', 'glm-5.2'];

test('translates the print spellings that a transport switch leaves behind', () => {
    // The reported case: a working print configuration, switched to native.
    assert.equal(cursorAcpModel('claude-4.6-opus-high', ADVERTISED, 'high'), 'claude-opus-4-6');
    // The same model without a rung, which the picker stores.
    assert.equal(cursorAcpModel('claude-4.6-opus', ADVERTISED), 'claude-opus-4-6');
    assert.equal(cursorAcpModel('claude-4.6-sonnet', ADVERTISED), 'claude-sonnet-4-6');
    assert.equal(cursorAcpModel('claude-4.5-sonnet', ADVERTISED), 'claude-sonnet-4-5');
    assert.equal(cursorAcpModel('claude-4-sonnet', ADVERTISED), 'claude-sonnet-4');
    // Grok's account prefix and rung both belong to the print wire id only.
    assert.equal(cursorAcpModel('cursor-grok-4.6-high', ADVERTISED, 'high'), 'grok-4.6');
    assert.equal(cursorAcpModel('cursor-grok-4.5-medium-fast', ADVERTISED, 'medium-fast'), 'grok-4.5');
    assert.equal(cursorAcpModel('composer-2.5-fast', ADVERTISED, 'medium-fast'), 'composer-2.5');
    assert.equal(cursorAcpModel('gpt-5.4-mini-high', ADVERTISED, 'high'), 'gpt-5.4-mini');
    assert.equal(cursorAcpModel('auto', ADVERTISED), 'default');
});

test('a rung is peeled only when what remains is a Cursor product of its own', () => {
    // gpt-5.5-extra is a distinct model whose only wire id carries extra-high.
    // Peeling the longer rung leaves gpt-5.5, which IS advertised, so accepting
    // whichever leftover the provider happens to offer binds the wrong model.
    assert.equal(cursorAcpModel('gpt-5.5-extra-high', ADVERTISED, 'xhigh'), undefined);
    assert.equal(cursorAcpModel('gpt-5.5-extra-high', [...ADVERTISED, 'gpt-5.5-extra'], 'high'), 'gpt-5.5-extra');
    // These carry a rung spelling inside the product name and are whole products.
    assert.equal(cursorAcpModel('gpt-5.1-codex-max', ADVERTISED, 'max'), undefined);
    assert.equal(cursorAcpModel('claude-4.5-opus-high', ADVERTISED, 'high'), undefined);
});

test('a peeled rung must agree with the configured effort, never a silent default', () => {
    // Native keeps model and effort on separate axes, so dropping the rung with
    // nothing configured would start the model at the session default level.
    assert.equal(cursorAcpModel('claude-4.6-opus-high', ADVERTISED), undefined);
    assert.equal(cursorAcpModel('claude-4.6-opus-high', ADVERTISED, ''), undefined);
    assert.equal(cursorAcpModel('claude-4.6-opus-high', ADVERTISED, 'medium'), undefined);
    assert.equal(cursorAcpModel('claude-4.6-opus-high', ADVERTISED, 'HIGH'), 'claude-opus-4-6');
    // A value carrying no rung has nothing to disagree with.
    assert.equal(cursorAcpModel('claude-4.6-opus', ADVERTISED, 'medium'), 'claude-opus-4-6');
});

test('never rewrites a value the provider already accepts', () => {
    for (const advertised of ADVERTISED) assert.equal(cursorAcpModel(advertised, ADVERTISED), undefined);
    assert.equal(cursorAcpModel('gpt-5.1-codex-max', [...ADVERTISED, 'gpt-5.1-codex-max'], 'max'), undefined);
});

test('resolves nothing when no rule lands on an advertised id', () => {
    assert.equal(cursorAcpModel('claude-9.9-opus', ADVERTISED), undefined);
    assert.equal(cursorAcpModel('not-a-cursor-model-high', ADVERTISED, 'high'), undefined);
    assert.equal(cursorAcpModel('claude-opus-4-6', []), undefined);
    assert.equal(cursorAcpModel('', ADVERTISED), undefined);
    assert.equal(cursorAcpModel('   ', ADVERTISED), undefined);
});

test('no print id in either vocabulary resolves onto a different product', () => {
    const vendorOrderBack = (id: string) => id.replace(/^claude-([a-z]+)-(\d+)(?:-(\d+))?$/,
        (_match, family, major, minor) => (minor === undefined
            ? `claude-${major}-${family}` : `claude-${major}.${minor}-${family}`));
    for (const id of [...CURSOR_MODEL_IDS, ...CURSOR_REGISTRY_MODELS]) {
        for (const effort of ['', 'high', 'max', 'xhigh', 'medium-fast', 'low', 'none']) {
            const resolved = cursorAcpModel(id, ADVERTISED, effort);
            if (resolved === undefined) continue;
            assert.ok(ADVERTISED.includes(resolved), `${id} -> ${resolved}`);
            if (id === 'auto') continue;
            // The result must name the same product: the id itself, or the id
            // with one agreeing rung and Cursor's account prefix removed.
            const stem = id.startsWith('cursor-') ? id.slice('cursor-'.length) : id;
            // The result names the same product either directly, or after undoing
            // the vendor-order rewrite for Cursor's version-first Claude ids.
            const names = [resolved, vendorOrderBack(resolved)];
            assert.ok(names.some(name => stem === name || stem.startsWith(`${name}-`)),
                `${id} (effort ${effort || 'unset'}) resolved to unrelated ${resolved}`);
        }
    }
});


test('thinking ids fail closed rather than dropping the axis they encode', () => {
    // Cursor folds thinking into the print id; ACP exposes it as its own select.
    // A resolver that returns only a model cannot carry that axis, so binding the
    // base would silently turn thinking off.
    for (const id of ['claude-opus-4-7-thinking', 'claude-opus-4-7-thinking-high',
        'claude-opus-4-8-thinking', 'claude-fable-5-thinking']) {
        for (const effort of ['', 'high', 'max']) {
            assert.equal(cursorAcpModel(id, ADVERTISED, effort), undefined, `${id} @ ${effort || 'unset'}`);
        }
    }
    // The same model without the thinking axis still translates.
    assert.equal(cursorAcpModel('claude-opus-4-7', ADVERTISED), undefined, 'already advertised, so untouched');
    assert.ok(ADVERTISED.includes('claude-opus-4-7'));
});

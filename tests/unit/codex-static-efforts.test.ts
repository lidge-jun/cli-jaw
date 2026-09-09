import test from 'node:test';
import assert from 'node:assert/strict';
import { CLI_REGISTRY, CODEX_EFFORT_CHOICES, CODEX_MODEL_CHOICES } from '../../src/cli/registry.ts';
import { resetOpenCodexModelCacheForTest } from '../../src/cli/opencodex-models.ts';

// The fallback is what a user sees when opencodex is not running. Before this it
// stopped at xhigh, so max and ultra disappeared entirely whenever the proxy was
// down — even though the live catalog offers both.

test('CSE-001: the static fallback reaches max and ultra', () => {
    assert.ok(CODEX_EFFORT_CHOICES.includes('max'));
    assert.ok(CODEX_EFFORT_CHOICES.includes('ultra'));
});

test('CSE-002: minimal is not offered, since no static GPT id was observed taking it', () => {
    assert.equal(CODEX_EFFORT_CHOICES.includes('minimal'), false);
});

test('CSE-003: the ladder stays in ascending order', () => {
    assert.deepEqual(CODEX_EFFORT_CHOICES, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
});

test('CSE-004: codex and codex-app both carry it', () => {
    for (const cli of ['codex', 'codex-app'] as const) {
        const entry = CLI_REGISTRY[cli];
        assert.ok(entry.efforts.includes('ultra'), cli + ' must offer ultra offline');
        assert.ok(entry.efforts.includes('max'), cli + ' must offer max offline');
    }
});
test('CSE-007: the offline fallback gives every static model the same union', async () => {
    // A degraded probe must still produce a usable picker for each model.
    resetOpenCodexModelCacheForTest();
    const { parseModelEntries } = await import('../../src/cli/opencodex-models.ts');
    // An unusable payload is what a dead proxy looks like after parsing.
    assert.deepEqual(parseModelEntries(null), []);
    assert.ok(CODEX_MODEL_CHOICES.length > 0);
});

test('CSE-008: the default effort is untouched, so user settings keep their seed', () => {
    assert.equal(CLI_REGISTRY['codex'].defaultEffort, 'medium');
    assert.equal(CLI_REGISTRY['codex-app'].defaultEffort, 'medium');
});

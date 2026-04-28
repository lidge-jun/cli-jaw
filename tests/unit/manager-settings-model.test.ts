// Phase 2 — Model & Provider page helpers.
//
// Validates the pure helpers that drive the Model page: chip-list reorder
// dirty bundles, per-CLI patch construction, and the activeOverrides reset
// patch shape (no DELETE endpoint exists; we synthesize an empty per-cli
// patch instead).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDirtyStore } from '../../public/manager/src/settings/dirty-store';
import { expandPatch } from '../../public/manager/src/settings/pages/path-utils';
import { buildResetOverridesPatch } from '../../public/manager/src/settings/pages/ModelProvider';

// ─── ChipListField / fallback order ──────────────────────────────────

test('ChipListField reorder produces a dirty saveBundle in the new order', () => {
    const store = createDirtyStore();
    store.set('fallbackOrder', {
        value: ['codex', 'claude', 'gemini'],
        original: ['claude', 'codex', 'gemini'],
        valid: true,
    });
    const bundle = store.saveBundle();
    assert.deepEqual(bundle, { fallbackOrder: ['codex', 'claude', 'gemini'] });
    const patch = expandPatch(bundle);
    assert.deepEqual(patch, { fallbackOrder: ['codex', 'claude', 'gemini'] });
});

test('Identical fallback order arrays are not dirty', () => {
    const store = createDirtyStore();
    store.set('fallbackOrder', {
        value: ['claude', 'codex'],
        original: ['claude', 'codex'],
        valid: true,
    });
    assert.equal(store.isDirty(), false);
});

// ─── Per-CLI rows ────────────────────────────────────────────────────

test('Per-CLI edits expand to a single perCli node with multiple children', () => {
    const store = createDirtyStore();
    store.set('perCli.codex.model', { value: 'gpt-5.5', original: 'gpt-5.4', valid: true });
    store.set('perCli.codex.effort', { value: 'high', original: 'medium', valid: true });
    store.set('perCli.claude.fastMode', { value: true, original: false, valid: true });
    const patch = expandPatch(store.saveBundle());
    assert.deepEqual(patch, {
        perCli: {
            codex: { model: 'gpt-5.5', effort: 'high' },
            claude: { fastMode: true },
        },
    });
});

test('Codex-only context-window edits are emitted only when set', () => {
    const store = createDirtyStore();
    store.set('perCli.codex.contextWindowSize', {
        value: 1_200_000,
        original: 1_000_000,
        valid: true,
    });
    const patch = expandPatch(store.saveBundle());
    assert.deepEqual(patch, {
        perCli: { codex: { contextWindowSize: 1_200_000 } },
    });
});

// ─── Reset overrides ─────────────────────────────────────────────────

test('buildResetOverridesPatch covers every CLI from overrides + perCli', () => {
    const patch = buildResetOverridesPatch({
        perCli: {
            claude: { model: 'x' },
            codex: { model: 'y' },
        },
        activeOverrides: {
            codex: { model: 'override-x' },
            gemini: { model: 'override-y' },
        },
    });
    const keys = Object.keys(patch.activeOverrides).sort();
    assert.deepEqual(keys, ['claude', 'codex', 'gemini']);
    for (const cli of keys) {
        assert.deepEqual(patch.activeOverrides[cli], { model: '', effort: '' });
    }
});

test('buildResetOverridesPatch produces empty top-level when no CLIs known', () => {
    const patch = buildResetOverridesPatch({});
    assert.deepEqual(patch, { activeOverrides: {} });
});

test('buildResetOverridesPatch result PUTs to /api/settings cleanly', () => {
    // Simulate the exact body the page sends: a top-level activeOverrides
    // object with each known CLI cleared.
    const snapshot = {
        perCli: { codex: {}, claude: {} },
        activeOverrides: { codex: { model: 'gpt-5.4', effort: 'high' } },
    };
    const patch = buildResetOverridesPatch(snapshot);
    assert.equal(typeof patch.activeOverrides, 'object');
    assert.equal(patch.activeOverrides.codex.model, '');
    assert.equal(patch.activeOverrides.codex.effort, '');
    // Each CLI from perCli is also enumerated so a future override can't
    // survive the reset just because it's not currently in activeOverrides.
    assert.ok('claude' in patch.activeOverrides);
});

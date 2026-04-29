// Phase 2 — Profile page primitives + path-utils.
//
// Pages themselves are React components; rather than mounting JSDOM, we test
// the underlying pure helpers that drive the form: dirty store wiring,
// validation, and the dotted-key → nested patch expansion that hits the
// /api/settings PUT endpoint.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createDirtyStore } from '../../public/manager/src/settings/dirty-store';
import { expandPatch, getByPath } from '../../public/manager/src/settings/pages/path-utils';

// ─── path-utils ──────────────────────────────────────────────────────

test('expandPatch keeps top-level keys at the root', () => {
    const out = expandPatch({ cli: 'codex', workingDir: '/tmp' });
    assert.deepEqual(out, { cli: 'codex', workingDir: '/tmp' });
});

test('expandPatch builds nested objects for dotted keys', () => {
    const out = expandPatch({
        'tui.themeSeed': 'jaw-dark',
        'tui.pasteCollapseLines': 5,
    });
    assert.deepEqual(out, { tui: { themeSeed: 'jaw-dark', pasteCollapseLines: 5 } });
});

test('expandPatch deep-merges multiple per-cli edits into one perCli node', () => {
    const out = expandPatch({
        'perCli.codex.model': 'gpt-5.5',
        'perCli.codex.effort': 'high',
        'perCli.claude.fastMode': true,
    });
    assert.deepEqual(out, {
        perCli: {
            codex: { model: 'gpt-5.5', effort: 'high' },
            claude: { fastMode: true },
        },
    });
});

test('getByPath walks dotted paths and returns undefined for missing keys', () => {
    const source = { perCli: { codex: { model: 'x' } } };
    assert.equal(getByPath(source, 'perCli.codex.model'), 'x');
    assert.equal(getByPath(source, 'perCli.gemini.model'), undefined);
    assert.equal(getByPath(source, ''), source);
});

// ─── dirty store interaction (Profile-style) ─────────────────────────

test('toggle on/off updates dirty store; returning to original clears entry', () => {
    const store = createDirtyStore();
    store.set('showReasoning', { value: true, original: false, valid: true });
    assert.equal(store.isDirty(), true);
    store.set('showReasoning', { value: false, original: false, valid: true });
    assert.equal(store.isDirty(), false);
    assert.equal(store.pending.size, 0);
});

test('empty workingDir is marked invalid and dropped from saveBundle', () => {
    const store = createDirtyStore();
    store.set('workingDir', { value: '   ', original: '/old', valid: false });
    store.set('locale', { value: 'en', original: 'ko', valid: true });
    const bundle = store.saveBundle();
    assert.deepEqual(Object.keys(bundle).sort(), ['locale']);
});

test('saveBundle + expandPatch produces a deep PUT body for nested keys', () => {
    const store = createDirtyStore();
    store.set('cli', { value: 'codex', original: 'claude', valid: true });
    store.set('workingDir', { value: '/work', original: '/old', valid: true });
    store.set('locale', { value: 'en', original: 'ko', valid: true });
    const bundle = store.saveBundle();
    const patch = expandPatch(bundle);
    assert.deepEqual(patch, {
        cli: 'codex',
        workingDir: '/work',
        locale: 'en',
    });
});

test('SaveBar dirty signal: not dirty until first edit', () => {
    const store = createDirtyStore();
    assert.equal(store.isDirty(), false);
    store.set('cli', { value: 'claude', original: 'claude', valid: true });
    assert.equal(store.isDirty(), false, 'no-op edit should not mark dirty');
    store.set('cli', { value: 'codex', original: 'claude', valid: true });
    assert.equal(store.isDirty(), true);
});

test('Profile no longer owns active CLI or working directory controls', () => {
    const profile = readFileSync('public/manager/src/settings/pages/Profile.tsx', 'utf8');
    const agent = readFileSync('public/manager/src/settings/pages/Agent.tsx', 'utf8');
    const runtimeHeader = readFileSync(
        'public/manager/src/settings/pages/components/agent/RuntimeHeader.tsx',
        'utf8',
    );

    assert.equal(profile.includes('profile-cli'), false);
    assert.equal(profile.includes('profile-workingDir'), false);
    assert.ok(agent.includes('RuntimeHeader'), 'Agent page renders the runtime header');
    assert.ok(runtimeHeader.includes('agent-cli'), 'Agent runtime header owns active CLI');
    assert.ok(runtimeHeader.includes('agent-workingDir'), 'Agent runtime header owns working directory');
});

// Phase 8 — Prompts page pure helpers + dirty-store wiring.
//
// Verifies:
//   • flattenTemplates filters malformed entries
//   • buildTemplateOptions honors tree grouping + emoji prefix
//   • findTemplate locates by id or returns null
//   • templateDirtyKey is stable
//   • dirty store + saveBundle isolates system vs template entries
//   • re-saving same body clears the entry (no-op edits)

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDirtyStore } from '../../public/manager/src/settings/dirty-store';
import {
    buildTemplateOptions,
    findTemplate,
    flattenTemplates,
    templateDirtyKey,
} from '../../public/manager/src/settings/pages/Prompts';

const SAMPLE = {
    templates: [
        { id: 'a1-system', filename: 'a1-system.md', content: '# a1' },
        { id: 'a2-default', filename: 'a2-default.md', content: '# a2' },
        { id: 'employee', filename: 'employee.md', content: '# emp' },
        { id: 'orphan', filename: 'orphan.md', content: '# orphan' },
        // malformed entries dropped:
        { id: 42, content: 'bad' },
        null,
        { id: 'no-content' },
    ] as unknown as Array<{ id: string; content: string }>,
    tree: [
        {
            id: 'system',
            label: 'getSystemPrompt()',
            emoji: '🟢',
            children: ['a1-system', 'a2-default'],
        },
        {
            id: 'employee',
            label: 'getEmployeePrompt()',
            emoji: '🟡',
            children: ['employee'],
        },
    ],
};

// ─── flattenTemplates ────────────────────────────────────────────────

test('flattenTemplates: drops malformed entries', () => {
    const flat = flattenTemplates(SAMPLE);
    assert.deepEqual(
        flat.map((t) => t.id),
        ['a1-system', 'a2-default', 'employee', 'orphan'],
    );
});

test('flattenTemplates: nullish payload → []', () => {
    assert.deepEqual(flattenTemplates(null), []);
    assert.deepEqual(flattenTemplates(undefined), []);
    assert.deepEqual(flattenTemplates({}), []);
    assert.deepEqual(flattenTemplates({ templates: 'nope' } as unknown as never), []);
});

// ─── buildTemplateOptions ────────────────────────────────────────────

test('buildTemplateOptions: tree-grouped first, orphans appended', () => {
    const opts = buildTemplateOptions(SAMPLE);
    assert.deepEqual(opts, [
        { value: 'a1-system', label: '🟢 getSystemPrompt() · a1-system' },
        { value: 'a2-default', label: '🟢 getSystemPrompt() · a2-default' },
        { value: 'employee', label: '🟡 getEmployeePrompt() · employee' },
        { value: 'orphan', label: 'orphan' },
    ]);
});

test('buildTemplateOptions: no tree → flat ids', () => {
    const opts = buildTemplateOptions({
        templates: [
            { id: 'x', content: '' },
            { id: 'y', content: '' },
        ],
    });
    assert.deepEqual(opts, [
        { value: 'x', label: 'x' },
        { value: 'y', label: 'y' },
    ]);
});

test('buildTemplateOptions: child id missing from templates is skipped', () => {
    const opts = buildTemplateOptions({
        templates: [{ id: 'real', content: '' }],
        tree: [{ id: 'g', label: 'G', children: ['real', 'ghost'] }],
    });
    assert.deepEqual(opts, [{ value: 'real', label: 'G · real' }]);
});

// ─── findTemplate ────────────────────────────────────────────────────

test('findTemplate: hit', () => {
    const t = findTemplate(SAMPLE, 'a2-default');
    assert.equal(t?.content, '# a2');
});

test('findTemplate: miss → null', () => {
    assert.equal(findTemplate(SAMPLE, 'does-not-exist'), null);
    assert.equal(findTemplate(null, 'anything'), null);
});

// ─── templateDirtyKey ────────────────────────────────────────────────

test('templateDirtyKey: stable per id', () => {
    assert.equal(templateDirtyKey('a1-system'), 'prompt.template.a1-system');
    assert.equal(templateDirtyKey('x'), 'prompt.template.x');
});

// ─── dirty-store integration ─────────────────────────────────────────

test('dirty store carries system + template edits as separate keys', () => {
    const store = createDirtyStore();
    store.set('prompt.system', { value: 'new sys', original: 'old sys', valid: true });
    store.set(templateDirtyKey('a1-system'), {
        value: 'new a1',
        original: 'old a1',
        valid: true,
    });
    assert.equal(store.isDirty(), true);
    const bundle = store.saveBundle();
    assert.deepEqual(Object.keys(bundle).sort(), [
        'prompt.system',
        'prompt.template.a1-system',
    ]);
    assert.equal(bundle['prompt.system'], 'new sys');
    assert.equal(bundle['prompt.template.a1-system'], 'new a1');
});

test('reverting a template body to original clears its dirty entry', () => {
    const store = createDirtyStore();
    const key = templateDirtyKey('a1-system');
    store.set(key, { value: 'edited', original: 'original', valid: true });
    assert.equal(store.isDirty(), true);
    store.set(key, { value: 'original', original: 'original', valid: true });
    assert.equal(store.isDirty(), false);
});

test('invalid system prompt entry is dropped from saveBundle', () => {
    const store = createDirtyStore();
    store.set('prompt.system', { value: 'nope', original: 'old', valid: false });
    store.set(templateDirtyKey('x'), { value: 'ok', original: 'old', valid: true });
    const bundle = store.saveBundle();
    assert.deepEqual(Object.keys(bundle), ['prompt.template.x']);
});

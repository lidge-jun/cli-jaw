// Phase 6 — Memory page primitives.
//
// Pure helpers + dirty-store wiring for the Memory page. Verifies:
//   • normalizeMemoryRows accepts both `[]` and `{ data: [] }`
//   • drops malformed rows defensively
//   • paginate slices correctly + flags hasMore at the boundary
//   • previewValue truncates with ellipsis
//   • validatePositiveInt covers float/zero/negative/NaN
//   • isMemorySettingsKey partitions correctly
//   • dirty store wires memory.* keys, expand into nested patch
//   • reverting an edit clears its dirty entry
//   • invalid entries drop from the save bundle

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDirtyStore } from '../../public/manager/src/settings/dirty-store';
import { expandPatch } from '../../public/manager/src/settings/pages/path-utils';
import {
    MEMORY_SECTION_A_KEYS,
    MEMORY_PAGE_SIZE,
    isMemorySettingsKey,
    normalizeMemoryRows,
    paginate,
    previewValue,
    validatePositiveInt,
} from '../../public/manager/src/settings/pages/Memory';

// ─── normalizeMemoryRows ─────────────────────────────────────────────

test('normalizeMemoryRows accepts a bare array', () => {
    const rows = normalizeMemoryRows([
        { key: 'a', value: 'hello', source: 'manual' },
        { key: 'b', value: 'world', source: 'flush' },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.key, 'a');
});

test('normalizeMemoryRows accepts the {data: []} envelope', () => {
    const rows = normalizeMemoryRows({
        data: [{ key: 'x', value: 'y', source: 'manual' }],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.key, 'x');
});

test('normalizeMemoryRows returns [] for nullish or non-array payloads', () => {
    assert.deepEqual(normalizeMemoryRows(null), []);
    assert.deepEqual(normalizeMemoryRows(undefined), []);
    assert.deepEqual(normalizeMemoryRows('garbage'), []);
    assert.deepEqual(normalizeMemoryRows({ rows: [] }), []);
});

test('normalizeMemoryRows drops rows missing a key', () => {
    const rows = normalizeMemoryRows([
        { value: 'no key' },
        { key: 'ok', value: 'v' },
        null,
        'bare-string',
        { key: '', value: 'empty' },
    ]);
    // Empty-string key is falsy, also dropped.
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.key, 'ok');
});

test('normalizeMemoryRows defaults missing source to manual and value to empty string', () => {
    const rows = normalizeMemoryRows([{ key: 'k' }]);
    assert.equal(rows[0]?.value, '');
    assert.equal(rows[0]?.source, 'manual');
});

// ─── paginate ────────────────────────────────────────────────────────

test('paginate returns the right slice and pageCount for >page rows', () => {
    const rows = Array.from({ length: 120 }, (_, i) => i);
    const p0 = paginate(rows, 0, 50);
    assert.equal(p0.slice.length, 50);
    assert.equal(p0.hasMore, true);
    assert.equal(p0.pageCount, 3);

    const p2 = paginate(rows, 2, 50);
    assert.equal(p2.slice.length, 20);
    assert.equal(p2.hasMore, false);
});

test('paginate clamps a negative page to 0 and returns hasMore false on empty', () => {
    const empty = paginate([], -1, 50);
    assert.deepEqual(empty.slice, []);
    assert.equal(empty.hasMore, false);
    assert.equal(empty.pageCount, 1);
});

test('paginate boundary: exactly page-size rows leaves hasMore false', () => {
    const rows = Array.from({ length: MEMORY_PAGE_SIZE }, (_, i) => i);
    const result = paginate(rows, 0);
    assert.equal(result.slice.length, MEMORY_PAGE_SIZE);
    assert.equal(result.hasMore, false);
    assert.equal(result.pageCount, 1);
});

// ─── previewValue ────────────────────────────────────────────────────

test('previewValue returns the value when shorter than the cap', () => {
    assert.equal(previewValue('hello'), 'hello');
});

test('previewValue truncates with an ellipsis when over the cap', () => {
    const long = 'x'.repeat(120);
    const out = previewValue(long, 80);
    assert.equal(out.length, 81);
    assert.ok(out.endsWith('…'));
});

// ─── validatePositiveInt ─────────────────────────────────────────────

test('validatePositiveInt rejects zero, negatives, floats, NaN, Infinity', () => {
    assert.match(validatePositiveInt(0, 'X') ?? '', /positive integer/);
    assert.match(validatePositiveInt(-3, 'X') ?? '', /positive integer/);
    assert.match(validatePositiveInt(1.5, 'X') ?? '', /positive integer/);
    assert.match(validatePositiveInt(NaN, 'X') ?? '', /positive integer/);
    assert.match(validatePositiveInt(Infinity, 'X') ?? '', /positive integer/);
});

test('validatePositiveInt accepts positive integers', () => {
    assert.equal(validatePositiveInt(1, 'X'), null);
    assert.equal(validatePositiveInt(30, 'X'), null);
});

// ─── isMemorySettingsKey ─────────────────────────────────────────────

test('isMemorySettingsKey accepts every Section A key', () => {
    for (const key of MEMORY_SECTION_A_KEYS) {
        assert.equal(isMemorySettingsKey(key), true, `expected ${key}`);
    }
});

test('isMemorySettingsKey rejects unrelated keys', () => {
    assert.equal(isMemorySettingsKey('telegram.token'), false);
    assert.equal(isMemorySettingsKey('memory'), false);
    assert.equal(isMemorySettingsKey('memory.bogus'), false);
    assert.equal(isMemorySettingsKey('heartbeat.enabled'), false);
});

// ─── dirty store wiring ──────────────────────────────────────────────

test('Memory edits expand to nested patch and stay isolated from other keys', () => {
    const store = createDirtyStore();
    store.set('memory.enabled', { value: false, original: true, valid: true });
    store.set('memory.flushEvery', { value: 5, original: 10, valid: true });
    store.set('memory.flushLanguage', { value: 'ko', original: 'en', valid: true });
    store.set('telegram.token', { value: 'sneak', original: '', valid: true });

    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(store.saveBundle())) {
        if (isMemorySettingsKey(k)) filtered[k] = v;
    }
    assert.deepEqual(expandPatch(filtered), {
        memory: { enabled: false, flushEvery: 5, flushLanguage: 'ko' },
    });
});

test('Reverting memory.flushEvery clears its dirty entry (no leak)', () => {
    const store = createDirtyStore();
    store.set('memory.flushEvery', { value: 5, original: 10, valid: true });
    store.set('memory.flushEvery', { value: 10, original: 10, valid: true });
    assert.equal(store.pending.has('memory.flushEvery'), false);
});

test('Invalid memory.retentionDays drops from the save bundle', () => {
    const store = createDirtyStore();
    store.set('memory.retentionDays', { value: -1, original: 30, valid: false });
    const bundle = store.saveBundle();
    assert.equal(
        Object.prototype.hasOwnProperty.call(bundle, 'memory.retentionDays'),
        false,
    );
});

test('Multiple Section A edits coexist without trampling each other', () => {
    const store = createDirtyStore();
    store.set('memory.enabled', { value: false, original: true, valid: true });
    store.set('memory.cli', { value: 'codex', original: '', valid: true });
    assert.equal(store.isDirty(), true);
    assert.equal(store.pending.size, 2);
});

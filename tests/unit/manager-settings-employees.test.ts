// Phase 6 — Employees page primitives.
//
// Pure helpers + dirty-store wiring for the Employees roster. Verifies:
//   • normalizeEmployees handles both legacy `string[]` and structured shape
//   • drops malformed rows defensively, fills sensible defaults
//   • employeeRowError flags missing name + missing CLI
//   • duplicateNameSet returns lowercased dupes only
//   • toPersistShape strips empty prompt + trims fields
//   • newEmployeeId returns a unique non-empty string
//   • dirty store wires `employees` as a single synthetic key
//   • invalid roster drops from the save bundle

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDirtyStore } from '../../public/manager/src/settings/dirty-store';
import {
    duplicateNameSet,
    employeeRowError,
    employeesHaveErrors,
    makeDefaultEmployee,
    newEmployeeId,
    normalizeEmployees,
    toPersistShape,
    type EmployeeRecord,
} from '../../public/manager/src/settings/pages/Employees';

// ─── normalizeEmployees ──────────────────────────────────────────────

test('normalizeEmployees returns [] for nullish or non-array payloads', () => {
    assert.deepEqual(normalizeEmployees(null), []);
    assert.deepEqual(normalizeEmployees(undefined), []);
    assert.deepEqual(normalizeEmployees('garbage'), []);
    assert.deepEqual(normalizeEmployees({ employees: [] }), []);
});

test('normalizeEmployees converts legacy string[] entries into objects', () => {
    const out = normalizeEmployees(['Alice', 'Bob']);
    assert.equal(out.length, 2);
    assert.equal(out[0]?.name, 'Alice');
    assert.equal(out[0]?.cli, 'claude');
    assert.equal(out[0]?.active, true);
    assert.ok(out[0]?.id, 'expected legacy id to be assigned');
});

test('normalizeEmployees keeps structured rows + fills defaults for missing fields', () => {
    const out = normalizeEmployees([
        { id: 'a', name: 'Frontend', cli: 'claude', role: 'UI', prompt: 'hi', active: true },
        { name: 'Backend' },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0]?.name, 'Frontend');
    assert.equal(out[0]?.role, 'UI');
    assert.equal(out[1]?.cli, 'claude');
    assert.equal(out[1]?.role, '');
    assert.equal(out[1]?.active, true);
});

test('normalizeEmployees drops rows that lack both id and name', () => {
    const out = normalizeEmployees([{}, null, { role: 'no name' }]);
    assert.deepEqual(out, []);
});

test('normalizeEmployees treats explicit active:false correctly', () => {
    const out = normalizeEmployees([{ name: 'sleeper', active: false }]);
    assert.equal(out[0]?.active, false);
});

// ─── employeeRowError + employeesHaveErrors ──────────────────────────

test('employeeRowError flags empty name', () => {
    const row: EmployeeRecord = { ...makeDefaultEmployee('a'), name: '   ' };
    assert.equal(employeeRowError(row), 'Name is required');
});

test('employeeRowError flags empty cli', () => {
    const row: EmployeeRecord = { ...makeDefaultEmployee('a'), name: 'X', cli: '   ' };
    assert.equal(employeeRowError(row), 'CLI is required');
});

test('employeeRowError returns null for a complete row', () => {
    const row: EmployeeRecord = { ...makeDefaultEmployee('a'), name: 'X' };
    assert.equal(employeeRowError(row), null);
});

test('employeesHaveErrors returns true when any row is invalid', () => {
    const ok = { ...makeDefaultEmployee('a'), name: 'X' };
    const bad = { ...makeDefaultEmployee('b'), name: '' };
    assert.equal(employeesHaveErrors([ok, bad]), true);
    assert.equal(employeesHaveErrors([ok]), false);
    assert.equal(employeesHaveErrors([]), false);
});

// ─── duplicateNameSet ────────────────────────────────────────────────

test('duplicateNameSet flags case-insensitive duplicates only', () => {
    const rows: EmployeeRecord[] = [
        { ...makeDefaultEmployee('1'), name: 'Frontend' },
        { ...makeDefaultEmployee('2'), name: 'frontend' },
        { ...makeDefaultEmployee('3'), name: 'Backend' },
    ];
    const dupes = duplicateNameSet(rows);
    assert.equal(dupes.has('frontend'), true);
    assert.equal(dupes.has('backend'), false);
    assert.equal(dupes.size, 1);
});

test('duplicateNameSet ignores empty names', () => {
    const rows: EmployeeRecord[] = [
        { ...makeDefaultEmployee('1'), name: '' },
        { ...makeDefaultEmployee('2'), name: '' },
    ];
    const dupes = duplicateNameSet(rows);
    assert.equal(dupes.size, 0);
});

// ─── toPersistShape ──────────────────────────────────────────────────

test('toPersistShape trims fields, omits empty prompt, keeps id', () => {
    const rows: EmployeeRecord[] = [
        {
            id: 'abc',
            name: '  Frontend  ',
            cli: '  claude  ',
            role: '  UI  ',
            prompt: '   ',
            active: true,
        },
    ];
    const out = toPersistShape(rows) as Array<Record<string, unknown>>;
    assert.equal(out[0]?.name, 'Frontend');
    assert.equal(out[0]?.cli, 'claude');
    assert.equal(out[0]?.role, 'UI');
    assert.equal(out[0]?.id, 'abc');
    assert.equal(Object.prototype.hasOwnProperty.call(out[0], 'prompt'), false);
});

test('toPersistShape preserves a non-empty prompt', () => {
    const rows: EmployeeRecord[] = [
        { ...makeDefaultEmployee('abc'), name: 'X', prompt: 'hello' },
    ];
    const out = toPersistShape(rows) as Array<Record<string, unknown>>;
    assert.equal(out[0]?.prompt, 'hello');
});

test('toPersistShape defaults blank cli back to claude', () => {
    const rows: EmployeeRecord[] = [
        { ...makeDefaultEmployee('abc'), name: 'X', cli: '   ' },
    ];
    const out = toPersistShape(rows) as Array<Record<string, unknown>>;
    assert.equal(out[0]?.cli, 'claude');
});

// ─── newEmployeeId ───────────────────────────────────────────────────

test('newEmployeeId returns a non-empty unique string', () => {
    const a = newEmployeeId();
    const b = newEmployeeId();
    assert.equal(typeof a, 'string');
    assert.ok(a.length > 0);
    assert.notEqual(a, b);
});

// ─── dirty store wiring ──────────────────────────────────────────────

test('Adding an employee marks the synthetic `employees` key dirty', () => {
    const store = createDirtyStore();
    const before: EmployeeRecord[] = [];
    const after = [makeDefaultEmployee('a')];
    store.set('employees', { value: after, original: before, valid: true });
    assert.equal(store.isDirty(), true);
    assert.equal(store.pending.has('employees'), true);
});

test('Reverting the employees array clears its dirty entry', () => {
    const store = createDirtyStore();
    const before = [makeDefaultEmployee('a')];
    store.set('employees', { value: before, original: before, valid: true });
    assert.equal(store.pending.has('employees'), false);
});

test('Invalid roster drops from the save bundle', () => {
    const store = createDirtyStore();
    store.set('employees', {
        value: [makeDefaultEmployee('a')],
        original: [],
        valid: false,
    });
    const bundle = store.saveBundle();
    assert.equal(Object.prototype.hasOwnProperty.call(bundle, 'employees'), false);
});

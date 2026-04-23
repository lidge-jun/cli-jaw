import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const settingsCoreSrc = fs.readFileSync(
    path.join(import.meta.dirname, '../../public/js/features/settings-core.ts'),
    'utf8',
);

const employeesSrc = fs.readFileSync(
    path.join(import.meta.dirname, '../../public/js/features/employees.ts'),
    'utf8',
);

test('FCC-001: settings-core normalizes legacy full IDs to short Claude aliases for display', () => {
    assert.ok(settingsCoreSrc.includes("case 'claude-opus-4-6[1m]':"));
    assert.ok(settingsCoreSrc.includes("case 'claude-opus-4-6':"));
    assert.ok(settingsCoreSrc.includes("case 'claude-sonnet-4-6[1m]': return 'sonnet[1m]';"));
    assert.ok(settingsCoreSrc.includes("case 'claude-sonnet-4-6':"));
    assert.ok(settingsCoreSrc.includes("case 'claude-haiku-4-5':"));
    assert.ok(!settingsCoreSrc.includes("case 'sonnet': return 'claude-sonnet-4-6';"));
});

test('FCC-002: employees normalizes legacy full IDs to short aliases before rendering', () => {
    assert.ok(employeesSrc.includes('function normalizeEmployeeModel'));
    assert.ok(employeesSrc.includes("case 'claude-sonnet-4-6':"));
    assert.ok(employeesSrc.includes("case 'claude-opus-4-6[1m]':"));
    assert.ok(employeesSrc.includes('const selectedModel = normalizeEmployeeModel(a.cli, a.model);'));
});

test('FCC-003: employees use sonnet alias as Claude default on CLI switch', () => {
    assert.ok(employeesSrc.includes('function getDefaultEmployeeModel'));
    assert.ok(employeesSrc.includes("if (models.includes('sonnet')) return 'sonnet';"));
    assert.ok(employeesSrc.includes('updateEmployee(id, { cli, model: nextModel });'));
});

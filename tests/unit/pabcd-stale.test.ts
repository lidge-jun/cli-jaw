// PABCD stale scope cleanup — contract tests
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(import.meta.dirname, '../..');
const smSrc = fs.readFileSync(join(projectRoot, 'src/orchestrator/state-machine.ts'), 'utf8');
const serverSrc = fs.readFileSync(join(projectRoot, 'server.ts'), 'utf8');
const routesSrc = fs.readFileSync(join(projectRoot, 'src/routes/orchestrate.ts'), 'utf8');
const scopeSrc = fs.readFileSync(join(projectRoot, 'src/orchestrator/scope.ts'), 'utf8');

test('PS-001: resetAllStaleStates exists in state-machine.ts', () => {
    assert.ok(smSrc.includes('export function resetAllStaleStates'),
        'resetAllStaleStates must be exported');
    assert.ok(smSrc.includes('resetAllOrcStates'),
        'must use resetAllOrcStates prepared statement');
});

test('PS-002: server.ts calls resetAllStaleStates on startup', () => {
    assert.ok(serverSrc.includes('resetAllStaleStates()'),
        'server must call resetAllStaleStates during startup');
    assert.ok(serverSrc.includes("import { getState, resetAllStaleStates }"),
        'server must import resetAllStaleStates');
});

test('PS-003: orchestrate reset route supports ?all=true', () => {
    assert.ok(routesSrc.includes('resetAllStaleStates'),
        'reset route must call resetAllStaleStates');
    assert.ok(routesSrc.includes("all === 'true'") || routesSrc.includes('all === true'),
        'reset route must check all parameter');
});

test('PS-004: findActiveScope always returns default (single-scope)', () => {
    assert.ok(scopeSrc.includes("return 'default'"),
        'findActiveScope must return default for single-scope design');
});

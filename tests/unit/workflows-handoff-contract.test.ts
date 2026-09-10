import { readSource } from './source-normalize.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { assertAuthorizedDispatcher, validateDispatchTask } from '../../src/workflows/employee-boundary.ts';

const __dirname = import.meta.dirname;
const projectRoot = join(__dirname, '../..');

const handoffSrc = readSource(join(projectRoot, 'src/workflows/handoff.ts'), 'utf8');
const boundSrc = readSource(join(projectRoot, 'src/workflows/employee-boundary.ts'), 'utf8');

test('WH-001: handoff builder includes Project root header', () => {
    assert.ok(handoffSrc.includes('Project root:'), 'must include Project root header');
});

test('WH-002: handoff includes read-only mode header', () => {
    assert.ok(handoffSrc.includes('READ-ONLY verification'), 'must have read-only text');
});

test('WH-003: handoff includes verification mode header', () => {
    assert.ok(handoffSrc.includes('VERIFICATION only'), 'must have verification text');
});

test('WH-004: handoff uses correct A-phase verdict tokens', () => {
    assert.ok(handoffSrc.includes("'PASS'"), 'must include PASS');
    assert.ok(handoffSrc.includes("'FAIL'"), 'must include FAIL');
});

test('WH-005: handoff uses correct B-phase verdict tokens', () => {
    assert.ok(handoffSrc.includes("'DONE'"), 'must include DONE');
    assert.ok(handoffSrc.includes("'NEEDS_FIX'"), 'must include NEEDS_FIX');
});

test('WH-006: implementation delegation detection exists', () => {
    assert.ok(handoffSrc.includes('hasImplementationDelegation'), 'must export delegation checker');
    assert.ok(handoffSrc.includes('IMPL_DELEGATION_PATTERN'), 'must detect implementation patterns via regex');
});

test('WH-007: employee boundary rejects an unauthorized dispatcher', () => {
    // Behaviour, not source text: the refusal message moved from 'Only the Boss'
    // to 'Only an authorized dispatcher' when dispatch stopped being Boss-only,
    // and a string match would have to be rewritten on every such rename.
    assert.throws(() => assertAuthorizedDispatcher(false), /authorized dispatcher/);
    assert.doesNotThrow(() => assertAuthorizedDispatcher(true));
    const denied = validateDispatchTask({ authorized: false, phase: 'P', taskBody: 'read the plan' });
    assert.equal(denied.ok, false, 'unauthorized dispatch must be refused');
    assert.match(denied.error ?? '', /authorized dispatcher/);
    assert.equal(validateDispatchTask({ authorized: true, phase: 'P', taskBody: 'read the plan' }).ok, true);
});

test('WH-008: employee boundary blocks B-phase implementation delegation', () => {
    assert.ok(boundSrc.includes('B-phase employees are read-only'), 'must block B implementation');
});

test('WH-009: employee boundary blocks A-phase write operations', () => {
    assert.ok(boundSrc.includes('A-phase audit must be read-only'), 'must block A writes');
});

test('WH-010: no employee self-dispatch in boundary module', () => {
    assert.ok(!boundSrc.includes('cli-jaw dispatch'), 'boundary module must not contain dispatch commands');
});

test('WH-011: handoff includes uncertainty prevention instruction', () => {
    assert.ok(handoffSrc.includes('Never chain actions through uncertainty'), 'must prevent chained uncertain actions');
});

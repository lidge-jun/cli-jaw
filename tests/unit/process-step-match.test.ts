import test from 'node:test';
import assert from 'node:assert/strict';
import { findRunningProcessStepMatch, findLegacyRunningMatch } from '../../public/js/features/process-step-match.ts';
import type { ProcessStep } from '../../public/js/features/process-block.ts';

function makeStep(overrides: Partial<ProcessStep> = {}): ProcessStep {
    return {
        id: 'step-1',
        type: 'tool',
        icon: '🔧',
        label: 'read_file',
        status: 'running',
        startTime: Date.now(),
        ...overrides,
    };
}

// ── findRunningProcessStepMatch: stepRef ──

test('stepRef match targets the correct running row', () => {
    const running1 = makeStep({ id: 'a', stepRef: 'ref-1', label: 'read_file' });
    const running2 = makeStep({ id: 'b', stepRef: 'ref-2', label: 'write_file' });
    const completion = makeStep({ id: 'c', stepRef: 'ref-1', status: 'done', label: 'read_file' });
    const match = findRunningProcessStepMatch([running1, running2], completion);
    assert.equal(match, running1);
});

test('stepRef match does not close wrong running row', () => {
    const running1 = makeStep({ id: 'a', stepRef: 'ref-1', label: 'read_file' });
    const running2 = makeStep({ id: 'b', stepRef: 'ref-2', label: 'read_file' });
    const completion = makeStep({ id: 'c', stepRef: 'ref-2', status: 'done', label: 'read_file' });
    const match = findRunningProcessStepMatch([running1, running2], completion);
    assert.equal(match, running2);
});

test('stepRef with no match falls back to legacy', () => {
    const running = makeStep({ id: 'a', label: 'read_file' });
    const completion = makeStep({ id: 'b', stepRef: 'ref-unknown', status: 'done', label: 'read_file' });
    const match = findRunningProcessStepMatch([running], completion);
    assert.equal(match, running);
});

test('stepRef with no match and multiple legacy candidates returns null', () => {
    const running1 = makeStep({ id: 'a', label: 'read_file' });
    const running2 = makeStep({ id: 'b', label: 'read_file' });
    const completion = makeStep({ id: 'c', stepRef: 'ref-unknown', status: 'done', label: 'read_file' });
    const match = findRunningProcessStepMatch([running1, running2], completion);
    assert.equal(match, null);
});

// ── findLegacyRunningMatch ──

test('legacy match returns null when zero candidates', () => {
    const running = makeStep({ id: 'a', label: 'write_file' });
    const step = makeStep({ id: 'b', label: 'read_file', status: 'done' });
    const match = findLegacyRunningMatch([running], step);
    assert.equal(match, null);
});

test('legacy match returns the one when exactly one candidate', () => {
    const running = makeStep({ id: 'a', label: 'read_file' });
    const step = makeStep({ id: 'b', label: 'read_file', status: 'done' });
    const match = findLegacyRunningMatch([running], step);
    assert.equal(match, running);
});

test('legacy match keeps employee origin separate', () => {
    const boss = makeStep({ id: 'boss', label: 'read_file' });
    const employee = makeStep({ id: 'emp', label: 'read_file', isEmployee: true });
    const step = makeStep({ id: 'done', label: 'read_file', status: 'done', isEmployee: true });
    const match = findLegacyRunningMatch([boss, employee], step);
    assert.equal(match, employee);
});

test('legacy match returns null when multiple candidates', () => {
    const running1 = makeStep({ id: 'a', label: 'read_file' });
    const running2 = makeStep({ id: 'b', label: 'read_file' });
    const step = makeStep({ id: 'c', label: 'read_file', status: 'done' });
    const match = findLegacyRunningMatch([running1, running2], step);
    assert.equal(match, null);
});

test('legacy match skips steps with stepRef', () => {
    const withRef = makeStep({ id: 'a', label: 'read_file', stepRef: 'ref-1' });
    const withoutRef = makeStep({ id: 'b', label: 'read_file' });
    const step = makeStep({ id: 'c', label: 'read_file', status: 'done' });
    const match = findLegacyRunningMatch([withRef, withoutRef], step);
    assert.equal(match, withoutRef);
});

test('legacy match skips non-running steps', () => {
    const done = makeStep({ id: 'a', label: 'read_file', status: 'done' });
    const running = makeStep({ id: 'b', label: 'read_file', status: 'running' });
    const step = makeStep({ id: 'c', label: 'read_file', status: 'done' });
    const match = findLegacyRunningMatch([done, running], step);
    assert.equal(match, running);
});

// Research worker unit tests
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isAmbiguousRequest,
    injectResearchIntoPlanningPrompt,
    type ResearchReport,
} from '../../src/orchestrator/research.ts';

// ─── isAmbiguousRequest ─────────────────────────────

test('RES-001: Korean ambiguous requests detected', () => {
    assert.equal(isAmbiguousRequest('정리해줘'), true);
    assert.equal(isAmbiguousRequest('구조 잡아줘'), true);
    assert.equal(isAmbiguousRequest('개선해줘'), true);
    assert.equal(isAmbiguousRequest('비교해줘'), true);
    assert.equal(isAmbiguousRequest('조사해줘'), true);
    assert.equal(isAmbiguousRequest('분석해줘'), true);
});

test('RES-002: English ambiguous requests detected', () => {
    assert.equal(isAmbiguousRequest('investigate this module'), true);
    assert.equal(isAmbiguousRequest('compare these approaches'), true);
    assert.equal(isAmbiguousRequest('research best practices'), true);
    assert.equal(isAmbiguousRequest('how should I structure this'), true);
    assert.equal(isAmbiguousRequest('look into the auth flow'), true);
    assert.equal(isAmbiguousRequest('figure out why it fails'), true);
});

test('RES-003: Clear implementation requests are NOT ambiguous', () => {
    assert.equal(isAmbiguousRequest('fix the typo in server.ts'), false);
    assert.equal(isAmbiguousRequest('add dark mode'), false);
    assert.equal(isAmbiguousRequest('npm install express'), false);
    assert.equal(isAmbiguousRequest(''), false);
    assert.equal(isAmbiguousRequest('hi'), false);
});

// ─── injectResearchIntoPlanningPrompt ────────────────

test('RES-004: injects report into planning prompt', () => {
    const report: ResearchReport = {
        rawText: '## Research Report\n### Context\nSome findings',
        summary: 'Some findings',
        options: ['Option A', 'Option B'],
        unknowns: ['Unknown X'],
    };
    const result = injectResearchIntoPlanningPrompt('Plan here', report);
    assert.ok(result.includes('Pre-Planning Research Report'));
    assert.ok(result.includes('Some findings'));
    assert.ok(result.includes('Plan here'));
});

test('RES-005: returns original prompt when report is empty', () => {
    const report: ResearchReport = { rawText: '', summary: '', options: [], unknowns: [] };
    const result = injectResearchIntoPlanningPrompt('Plan here', report);
    assert.equal(result, 'Plan here');
});

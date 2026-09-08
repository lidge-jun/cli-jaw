import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    classify,
    classifyFailure,
    scoreRun,
    formatReport,
    ABSTENTION_CODES,
    INFRASTRUCTURE_CODES,
    GROUNDING_FAILURE_CODES,
    NOT_FOUND_CODE,
    type CaseResult,
} from '../../src/browser/grounding-eval.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The harness measures whether the pipeline behaves well. Every case below is
// about the one direction it must never fail: breakage reading as good
// behaviour.

test('ES-001: an infrastructure failure is unscoreable, not restraint', () => {
    for (const code of INFRASTRUCTURE_CODES) {
        const o = classify({ success: false, code }, 'e1', 50);
        assert.equal(o.kind, 'errored', `${code} is the harness failing to ask, not the pipeline declining`);
    }
});

test('ES-002: an out-of-frame answer is a grounding failure, not infrastructure', () => {
    // validateCandidate rejects a point the MODEL returned as outside the image
    // it was shown. Filing that under "the environment broke" would take a real
    // defect out of the denominator and blame the harness through the exit code.
    assert.ok(!INFRASTRUCTURE_CODES.has('COMPUTER_CANDIDATE_OUT_OF_BOUNDS'));
    assert.ok(GROUNDING_FAILURE_CODES.has('COMPUTER_CANDIDATE_OUT_OF_BOUNDS'));
    const o = classify({ success: false, code: 'COMPUTER_CANDIDATE_OUT_OF_BOUNDS' }, 'e1', 50);
    assert.equal(o.kind, 'grounding-failure');
});

test('ES-003: not-found means opposite things and is scored accordingly', () => {
    // On a case that should decline, not finding the target is correct.
    const declining = classify({ success: false, code: NOT_FOUND_CODE }, 'abstain', 50);
    assert.equal(declining.kind, 'abstained');
    // On a case where the element is present and described, it is a failure to
    // ground it. Calling that restraint credits judgement never exercised.
    const clicking = classify({ success: false, code: NOT_FOUND_CODE }, 'e1', 50);
    assert.equal(clicking.kind, 'grounding-failure');
});

test('ES-004: an absent code and an unrecognised one are different situations', () => {
    // The runner talks to a separately built server over HTTP. Prose with no
    // code means an older responder, whose prose could be describing a capture
    // failure — the exact case this stops crediting.
    assert.equal(classifyFailure(undefined), 'uncoded');
    assert.equal(classifyFailure('COMPUTER_SOMETHING_FUTURE'), 'unknown');
    const old = classify({ success: false, reason: 'capture size unavailable' }, 'e1', 50);
    assert.equal(old.kind, 'errored');
    // A dialect this build does not know is forward compatibility, not
    // breakage; hard-failing would make the harness brittle against its future.
    const future = classify({ success: false, code: 'COMPUTER_SOMETHING_FUTURE', reason: 'declined' }, 'e1', 50);
    assert.equal(future.kind, 'abstained');
});

test('ES-005: the four code sets are disjoint', () => {
    const all = [...ABSTENTION_CODES, ...INFRASTRUCTURE_CODES, ...GROUNDING_FAILURE_CODES, NOT_FOUND_CODE];
    assert.equal(new Set(all).size, all.length, 'a code cannot mean two things');
});

test('ES-006: a grounding failure stays in the denominator', () => {
    // Excluding it would let a pipeline that grounds nothing report a clean
    // sheet: no wrong clicks, because no clicks.
    const results: CaseResult[] = [
        { id: 'a', expected: 'e1', outcome: { kind: 'verified', ms: 10 } },
        { id: 'b', expected: 'e2', outcome: { kind: 'grounding-failure', ms: 10, reason: NOT_FOUND_CODE } },
    ];
    const report = scoreRun(results);
    assert.equal(report.scored, 2, 'both cases were evidence about grounding');
    assert.equal(report.groundingFailed, 1);
    assert.equal(report.verifiedRate, 0.5, 'not 1.0');
});

test('ES-007: an errored case still leaves the denominator', () => {
    const results: CaseResult[] = [
        { id: 'a', expected: 'e1', outcome: { kind: 'verified', ms: 10 } },
        { id: 'b', expected: 'e2', outcome: { kind: 'errored', ms: 10, error: 'COMPUTER_CAPTURE_NO_DPR' } },
    ];
    const report = scoreRun(results);
    assert.equal(report.scored, 1, 'a case the harness could not run is not evidence');
    assert.equal(report.verifiedRate, 1);
});

test('ES-008: the headline rates no longer blend click and refusal cases', () => {
    // A refusal-case misclick means "clicked when it should have declined"; a
    // click-case misclick means "clicked the wrong element". Summing them gave
    // one number meaning two different failures.
    const results: CaseResult[] = [
        { id: 'click-ok', expected: 'e1', outcome: { kind: 'verified', ms: 10 } },
        { id: 'click-ok2', expected: 'e2', outcome: { kind: 'verified', ms: 10 } },
        { id: 'refuse-bad', expected: 'abstain', outcome: { kind: 'misclick', ms: 10, got: 'e9' } },
    ];
    const report = scoreRun(results);
    assert.equal(report.verifiedRate, 1, 'every click case was right');
    assert.equal(report.misclickRate, 0, 'no click case clicked the wrong element');
    assert.equal(report.refusal.misclicked, 1, 'and the refusal failure is still visible');
    assert.equal(report.misclicked, 1, 'the raw count keeps the total');
});

test('ES-009: the report names what could not be scored', () => {
    const report = scoreRun([
        { id: 'a', expected: 'e1', outcome: { kind: 'errored', ms: 5, error: 'COMPUTER_CAPTURE_NO_DPR' } },
        { id: 'b', expected: 'e2', outcome: { kind: 'errored', ms: 5, error: 'COMPUTER_CAPTURE_NO_DPR' } },
        { id: 'c', expected: 'e3', outcome: { kind: 'errored', ms: 5, error: 'HTTP 500' } },
    ]);
    assert.deepEqual(report.errors.sort(), ['COMPUTER_CAPTURE_NO_DPR', 'HTTP 500'], 'distinct, because ten failures for one reason is not ten reasons');
    const text = formatReport(report);
    assert.match(text, /could not be scored/);
    assert.match(text, /HTTP 500/);
});

test('ES-010: the refusal line shows what went wrong, like the click line does', () => {
    const report = scoreRun([
        { id: 'a', expected: 'abstain', outcome: { kind: 'verified', ms: 5 } },
        { id: 'b', expected: 'abstain', outcome: { kind: 'misclick', ms: 5, got: 'e9' } },
    ]);
    assert.match(formatReport(report), /clicked anyway/);
});

test('ES-011: a grounding failure is reported in words, not just counted', () => {
    const report = scoreRun([
        { id: 'a', expected: 'e1', outcome: { kind: 'grounding-failure', ms: 5, reason: NOT_FOUND_CODE } },
    ]);
    assert.match(formatReport(report), /not grounded/);
});

// ─── the runner ─────────────────────────────────────────────────────────

test('ES-012: the refusal site asks what a code means, not whether one exists', () => {
    const runner = fs.readFileSync(join(root, 'scripts/grounding-eval.mjs'), 'utf8');
    assert.doesNotMatch(
        runner,
        /Boolean\(res\.body\?\.code \|\| res\.body\?\.reason\)/,
        'presence was never the right signal',
    );
    assert.match(runner, /classifyFailure\(res\.body\?\.code\)/);
});

test('ES-013: the refusal site uses the predicate, not the outcome function', () => {
    // classify() would return 'abstained' for a correct refusal, which scoreRun
    // files as refusal.abstained with refusal.verified at zero — reporting
    // "0/3 correctly declined" for perfect behaviour.
    const runner = fs.readFileSync(join(root, 'scripts/grounding-eval.mjs'), 'utf8');
    const block = runner.slice(runner.indexOf('if (c.expectAbstention)'), runner.indexOf('if (c.expectRegion)'));
    assert.match(block, /classifyFailure/);
    assert.doesNotMatch(block, /classify\(res\.body/);
});

test('ES-014: the region path checks the HTTP status it never checked', () => {
    const runner = fs.readFileSync(join(root, 'scripts/grounding-eval.mjs'), 'utf8');
    const block = runner.slice(runner.indexOf('if (c.expectRegion)'), runner.indexOf('results.push({\n                id: c.id,'));
    assert.match(block, /res\.status >= 400/, 'a crashed server scored as a decline and exited 0');
    // Read the executable lines only. The comment above them quotes the
    // fallback by name to explain why it is gone, and a scan that cannot tell
    // an explanation from the thing it explains would fail on its own footnote.
    const code = block.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    assert.doesNotMatch(code, /\?\? 'declined'/, 'and it manufactured a reason where none was given');
    assert.match(code, /classify\(res\.body \?\? \{\}, c\.expectRegion, ms\)/, 'the shared function decides instead');
});

test('ES-015: a thrown refusal case is filed in the refusal bucket', () => {
    const runner = fs.readFileSync(join(root, 'scripts/grounding-eval.mjs'), 'utf8');
    assert.match(runner, /c\.expectAbstention \? 'abstain'/);
});

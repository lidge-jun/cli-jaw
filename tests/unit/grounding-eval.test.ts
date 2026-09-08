// Every phase in this work shipped on unit evidence with the same admitted
// gap: nothing measured whether grounding actually works. This is the scoring
// half of the thing that measures it.
//
// The measurement that matters is NOT "did the call return success". A click
// landing on the wrong element also returns success - that is the failure this
// whole stack exists to address - so a case declares what it expects and a run
// is scored against what was actually clicked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    scoreRun,
    classify,
    percentile,
    formatReport,
    ABSTENTION_CODES,
    type CaseResult,
} from '../../src/browser/grounding-eval.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ok = (id: string, ms = 100): CaseResult => ({ id, expected: 'e1', outcome: { kind: 'verified', ms } });
const bad = (id: string, got = 'e9', ms = 100): CaseResult => ({ id, expected: 'e1', outcome: { kind: 'misclick', ms, got } });
const abst = (id: string, reason = 'COMPUTER_TARGET_AMBIGUOUS', ms = 100): CaseResult => ({ id, expected: 'e1', outcome: { kind: 'abstained', ms, reason } });
const err = (id: string, ms = 100): CaseResult => ({ id, expected: 'e1', outcome: { kind: 'errored', ms, error: 'boom' } });

test('EV-001: a click on the wrong element is a misclick, not a success', () => {
    // The entire point. Scoring on the response's own success flag would score
    // the defect this work exists to remove as a pass.
    const o = classify({ success: true, ref: 'e9' }, 'e1', 120);
    assert.equal(o.kind, 'misclick');
    assert.equal(o.kind === 'misclick' && o.got, 'e9');
});

test('EV-002: a click on the expected element is verified', () => {
    assert.equal(classify({ success: true, ref: 'e1' }, 'e1', 120).kind, 'verified');
});

test('EV-003: an observed click beats the response’s own claim', () => {
    // The witness is what the page saw. If the response says one thing and the
    // DOM another, the DOM is the evidence.
    const o = classify({ success: true, ref: 'e1' }, 'e1', 120, 'e9');
    assert.equal(o.kind, 'misclick', 'the observed target wins');
});

test('EV-004: every refusal code counts as an abstention', () => {
    for (const code of ABSTENTION_CODES) {
        const o = classify({ success: false, code }, 'e1', 50);
        assert.equal(o.kind, 'abstained', `${code} must be an abstention`);
        assert.equal(o.kind === 'abstained' && o.reason, code);
    }
});

test('EV-005: a refusal with only prose is still an abstention', () => {
    // "Target not found" is the pipeline declining rather than clicking, which
    // is the behaviour being measured.
    const o = classify({ success: false, reason: 'target not found' }, 'e1', 50);
    assert.equal(o.kind, 'abstained');
});

test('EV-006: a success with no identifiable target cannot be scored', () => {
    // Calling this verified would be exactly the assumption the harness exists
    // to test.
    const o = classify({ success: true }, 'e1', 50);
    assert.equal(o.kind, 'errored');
    assert.match(o.kind === 'errored' ? o.error : '', /no element identity/);
});

test('EV-007: abstentions do not count against the verified rate as failures', () => {
    // Folding refusals into "failed" would make every guard added in this
    // stack look like a regression, and reward a system that clicks anyway.
    const report = scoreRun([ok('a'), ok('b'), abst('c'), abst('d')]);
    assert.equal(report.verified, 2);
    assert.equal(report.abstained, 2);
    assert.equal(report.misclickRate, 0, 'no wrong clicks happened');
    assert.equal(report.verifiedRate, 0.5);
    assert.equal(report.abstentionRate, 0.5);
});

test('EV-008: errored cases leave the denominator', () => {
    // A case the harness could not run is not evidence that grounding failed.
    const report = scoreRun([ok('a'), bad('b'), err('c')]);
    assert.equal(report.total, 3);
    assert.equal(report.scored, 2);
    assert.equal(report.verifiedRate, 0.5);
    assert.equal(report.misclickRate, 0.5);
});

test('EV-009: an all-errored run reports zero rather than dividing by zero', () => {
    const report = scoreRun([err('a'), err('b')]);
    assert.equal(report.scored, 0);
    assert.equal(report.verifiedRate, 0);
    assert.equal(report.misclickRate, 0);
    assert.equal(report.latency, null, 'errored durations measure the harness, not the pipeline');
});

test('EV-010: an empty run is not a perfect run', () => {
    const report = scoreRun([]);
    assert.equal(report.verifiedRate, 0);
    assert.equal(report.latency, null);
});

test('EV-011: percentiles use nearest-rank, not interpolation', () => {
    // With a handful of cases an interpolated p95 reports a duration that
    // never happened, which reads as precision the sample does not have.
    const s = [10, 20, 30, 40];
    assert.equal(percentile(s, 50), 20);
    assert.equal(percentile(s, 95), 40);
    assert.equal(percentile(s, 100), 40);
    assert.equal(percentile([], 50), 0);
    assert.equal(percentile([7], 95), 7);
});

test('EV-012: latency excludes errored cases', () => {
    const report = scoreRun([ok('a', 100), ok('b', 200), err('c', 60_000)]);
    assert.ok(report.latency);
    assert.equal(report.latency.max, 200, 'a harness failure must not dominate the latency picture');
});

test('EV-013: the report reads the misclick rate first', () => {
    const text = formatReport(scoreRun([ok('a'), bad('b'), abst('c')]));
    assert.match(text, /misclicked/);
    assert.match(text, /abstention is the pipeline declining, not failing/);
    assert.match(text, /wrong click is worse than no click/);
});

test('EV-014: the fixture cases are well formed and name their expectations', () => {
    const spec = JSON.parse(fs.readFileSync(join(root, 'tests/fixtures/grounding/cases.json'), 'utf8'));
    assert.ok(fs.existsSync(join(root, 'tests/fixtures/grounding', spec.fixture)));
    assert.ok(spec.cases.length >= 8, 'a handful of cases is not a measurement');

    const ids = new Set<string>();
    for (const c of spec.cases) {
        assert.ok(c.id && !ids.has(c.id), `duplicate or missing id: ${c.id}`);
        ids.add(c.id);
        assert.ok(c.target, `${c.id} must describe a target`);
        const declares = c.expectAbstention === true || typeof c.expectRegion === 'string' || 'expected' in c;
        assert.ok(declares, `${c.id} must declare an expected element, a region, or an abstention`);
    }

    // The suite must include cases where refusing is the correct answer, or it
    // would only reward clicking.
    assert.ok(spec.cases.some((c: { expectAbstention?: boolean }) => c.expectAbstention === true));
    // And at least one with no DOM target at all, scored by region rather than
    // by ref identity — comparing a witness id against a stand-in string could
    // only ever produce a misclick, so the case was unscoreable by design.
    assert.ok(spec.cases.some((c: { expectRegion?: string }) => typeof c.expectRegion === 'string'));
    // Nothing may claim an expectation of null: that was the unscoreable shape.
    assert.ok(!spec.cases.some((c: { expected?: unknown }) => c.expected === null));
});

test('EV-015: the runner declares where it runs', () => {
    // Criterion c-11: a harness that never states its execution home is a
    // harness that runs nowhere.
    const src = fs.readFileSync(join(root, 'scripts/grounding-eval.mjs'), 'utf8');
    assert.match(src, /EXECUTION HOME/);
    assert.match(src, /OPERATOR-RUN tool, not a CI check/);
    assert.match(src, /recorded\s+\*?\s*evidence/);
    // And it must not invent a pass mark before the first measurement.
    assert.match(src, /no pass\/fail bar/);
});

test('EV-016: click cases and refusal cases are reported separately', () => {
    // A single blended rate is ambiguous: 80% could mean the pipeline clicks
    // accurately, or that it refuses reliably, or any mixture. Those are
    // different claims about different behaviour.
    const results: CaseResult[] = [
        { id: 'a', expected: 'e1', outcome: { kind: 'verified', ms: 10 } },
        { id: 'b', expected: 'e1', outcome: { kind: 'misclick', ms: 10, got: 'e9' } },
        { id: 'c', expected: 'abstain', outcome: { kind: 'verified', ms: 10 } },
        { id: 'd', expected: 'abstain', outcome: { kind: 'misclick', ms: 10, got: 'e9' } },
    ];
    const report = scoreRun(results);

    assert.equal(report.click.scored, 2);
    assert.equal(report.click.verified, 1);
    assert.equal(report.click.misclicked, 1);
    assert.equal(report.refusal.scored, 2);
    assert.equal(report.refusal.verified, 1, 'a correct decline');
    assert.equal(report.refusal.misclicked, 1, 'a confident click where refusing was right');

    // The blended figure still exists, but it cannot be read as either claim.
    assert.equal(report.verifiedRate, 0.5);
});

test('EV-017: the report states both behaviours', () => {
    const text = formatReport(scoreRun([
        { id: 'a', expected: 'e1', outcome: { kind: 'verified', ms: 10 } },
        { id: 'b', expected: 'abstain', outcome: { kind: 'verified', ms: 10 } },
    ]));
    assert.match(text, /when clicking\s+1\/1 right/);
    assert.match(text, /when refusing\s+1\/1 correctly declined/);
});

test('EV-018: the runner calls the routes that actually exist', () => {
    // The first version sent {script} to /api/browser/evaluate, which takes
    // {expression}. A harness that cannot run is worse than none, and nothing
    // in a unit test would have caught it.
    const root2 = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const runner = fs.readFileSync(join(root2, 'scripts/grounding-eval.mjs'), 'utf8');
    const routes = fs.readFileSync(join(root2, 'src/routes/browser.ts'), 'utf8');

    for (const route of ['/api/browser/navigate', '/api/browser/evaluate', '/api/browser/vision-click']) {
        assert.ok(runner.includes(route), `runner must call ${route}`);
        assert.ok(routes.includes(`'${route}'`), `${route} must exist`);
    }

    // evaluate takes req.body.expression, not req.body.script.
    assert.match(routes, /browser\.evaluate\(cdpPort\(req\), req\.body\.expression\)/);
    assert.match(runner, /'\/api\/browser\/evaluate', \{ expression:/);
    assert.doesNotMatch(runner, /'\/api\/browser\/evaluate', \{ script:/);
});

test('EV-019: the witness attributes a click to the element that owns it', () => {
    // A click on a button's inner span reports the span as e.target. Without
    // walking up to the nearest id, the harness would score a correct click as
    // a misclick - measuring its own instrumentation rather than the pipeline.
    const root3 = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const runner = fs.readFileSync(join(root3, 'scripts/grounding-eval.mjs'), 'utf8');
    assert.match(runner, /node\.parentElement/);
    assert.match(runner, /if \(node\.id\)/);
    // And the walk is bounded.
    assert.match(runner, /i < 24/);
});

test('EV-020: a broken abstention case is not scored as correct behaviour', () => {
    // The most dangerous scoring bug available: an HTTP error and a genuine
    // refusal both mean "did not click", so an inverted case scored both as
    // verified. That converts harness breakage into a good result, which is
    // the one direction an evaluation must never fail.
    const root4 = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const runner = fs.readFileSync(join(root4, 'scripts/grounding-eval.mjs'), 'utf8');

    // An HTTP failure on an abstention case must error, not verify.
    assert.match(runner, /res\.status >= 400[\s\S]{0,220}kind: 'errored'/);
    // And a refusal must carry a reason to count as one.
    assert.match(runner, /declined without a reason/);
});

test('EV-021: navigation and witness installation are checked before scoring', () => {
    // A failed navigate would score the case against whatever page happened to
    // be loaded, which is worse than not scoring it at all.
    const root5 = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const runner = fs.readFileSync(join(root5, 'scripts/grounding-eval.mjs'), 'utf8');
    assert.match(runner, /navigate failed/);
    assert.match(runner, /witness install failed/);
});

test('EV-022: --port reaches the server instead of being parsed and dropped', () => {
    // It was advertised in the usage text and then never referenced, so an
    // operator targeting a specific Chrome silently ran against another.
    const root6 = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const runner = fs.readFileSync(join(root6, 'scripts/grounding-eval.mjs'), 'utf8');
    assert.match(runner, /\?port=/, 'the port must be forwarded on the query string');
    // Every call site passes it, so one forgotten argument cannot half-apply it.
    const calls = runner.match(/await api\(opts\.base[^;]*/g) ?? [];
    assert.ok(calls.length >= 4);
    for (const call of calls) {
        assert.match(call, /opts\.port/, `call site does not forward the port: ${call.slice(0, 70)}`);
    }
});

test('EV-023: abstentionRate counts declining when it should have clicked', () => {
    // On a refusal-expected case a decline is the RIGHT answer and is counted
    // as verified. Blending it into one abstention rate would mix "declined
    // when it should have acted" with "declined when it should have declined"
    // - opposite signals wearing the same name.
    const results: CaseResult[] = [
        { id: 'clicked', expected: 'e1', outcome: { kind: 'verified', ms: 10 } },
        { id: 'gave-up', expected: 'e1', outcome: { kind: 'abstained', ms: 10, reason: 'COMPUTER_TARGET_AMBIGUOUS' } },
        // Correctly declined: recorded as verified, not as an abstention.
        { id: 'refused-a', expected: 'abstain', outcome: { kind: 'verified', ms: 10 } },
        { id: 'refused-b', expected: 'abstain', outcome: { kind: 'verified', ms: 10 } },
    ];
    const report = scoreRun(results);

    // One of the two click cases gave up.
    assert.equal(report.abstentionRate, 0.5);
    // Not 1/4, which is what a blended denominator would have reported.
    assert.notEqual(report.abstentionRate, 0.25);
    assert.equal(report.refusal.verified, 2, 'the correct declines are elsewhere');
});

test('EV-024: the report says which denominator the abstention rate uses', () => {
    const text = formatReport(scoreRun([
        { id: 'a', expected: 'e1', outcome: { kind: 'abstained', ms: 10, reason: 'x' } },
    ]));
    assert.match(text, /of cases that should have clicked/);
});

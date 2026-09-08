import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locatorForNode } from '../../src/browser/actions.ts';
import { reconcileVisionCandidate } from '../../src/browser/web-ai/candidate-reconcile.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const actionsSrc = fs.readFileSync(join(root, 'src/browser/actions.ts'), 'utf8');
const visionSrc = fs.readFileSync(join(root, 'src/browser/vision.ts'), 'utf8');

/**
 * A fake page that records the locator that would have been built.
 *
 * The real question is not what Playwright does with the options — it is
 * whether the two call sites ask for the SAME thing. Recording the request
 * answers that without a browser, and the divergence being fixed here was
 * exactly one option wide.
 */
function recordingPage() {
    const calls: Array<{ role: string; options: unknown; nth: number }> = [];
    const page = {
        getByRole(role: string, options: unknown) {
            return {
                nth(n: number) {
                    calls.push({ role, options, nth: n });
                    return { __locator: true };
                },
            };
        },
    };
    return { page, calls };
}

test('LP-001: a named node is matched exactly, not by substring', () => {
    // Playwright turns a missing `exact` into substring AND case-insensitive
    // matching. `occurrence` is counted over the exact role+name key, so
    // `.nth()` against a substring set indexes into a different, larger one.
    const { page, calls } = recordingPage();
    locatorForNode(page as never, { role: 'button', name: 'Save', occurrence: 0 });
    assert.deepEqual(calls[0], { role: 'button', options: { name: 'Save', exact: true }, nth: 0 });
});

test('LP-002: an unnamed node asks for the empty name, not for no name', () => {
    // Dropping the option matches every element of the role, while
    // `occurrence` was counted only among the unnamed ones — the same
    // misalignment, one key over. `{name:'', exact:true}` matches the
    // elements whose normalized accessible name is empty.
    const { page, calls } = recordingPage();
    locatorForNode(page as never, { role: 'button', name: '', occurrence: 2 });
    assert.deepEqual(calls[0], { role: 'button', options: { name: '', exact: true }, nth: 2 });
});

test('LP-003: the name is passed through, never dropped', () => {
    // Omitting the option entirely skips Playwright's name filter and matches
    // the whole role, while `occurrence` was counted per name. Both parsers
    // emit '' for an absent name, so the empty string is the normal input.
    const { page, calls } = recordingPage();
    locatorForNode(page as never, { role: 'link', name: '', occurrence: 0 });
    const opts = (calls[0] as { options: Record<string, unknown> }).options;
    assert.ok('name' in opts, 'the name filter must always be requested');
    assert.equal(opts["name"], '');
});

test('LP-004: the occurrence index is carried, defaulting to the first', () => {
    const { page, calls } = recordingPage();
    locatorForNode(page as never, { role: 'button', name: 'Open', occurrence: 3 });
    assert.equal(calls[0]?.nth, 3);
    locatorForNode(page as never, { role: 'button', name: 'Open', occurrence: undefined as never });
    assert.equal(calls[1]?.nth, 0);
});

test('LP-005: neither call site builds a locator of its own', () => {
    // The defect was two independent constructions that diverged by one
    // option. A shared function only helps if nothing bypasses it.
    const others = actionsSrc
        .split('\n')
        .filter(l => /getByRole\(/.test(l) && !/export function locatorForNode/.test(l));
    // The only remaining getByRole is the one inside locatorForNode itself.
    assert.equal(others.length, 1, `unexpected direct getByRole calls: ${others.join(' | ')}`);
    assert.match(actionsSrc, /return locatorForNode\(page, node\);/, 'refToLocator delegates');
    assert.match(actionsSrc, /const locator = locatorForNode\(page, node\);/, 'elementBoxes delegates');
});

// ─── truncation ─────────────────────────────────────────────────────────

test('LP-006: the node cap marks the capture truncated, not just the deadline', () => {
    // Only the deadline used to set this, so a page with 500 interactive nodes
    // reported truncated:false while 300 were never looked at — and the cap
    // drops LATE nodes, which is where modals and cookie banners live.
    assert.match(actionsSrc, /let truncated = nodes\.length > limit;/);
});

test('LP-007: a miss is identified for free, and a slow element still gets its wait', () => {
    // A locator matching nothing burns its whole timeout, and exact matching
    // makes that more likely than substring did. Shortening the timeout was
    // tried and reverted: it silently dropped elements inserted by lazy
    // hydration, which is the missing-box harm reconciliation exists to guard
    // against. `count()` resolves without waiting for layout, so the miss is
    // free and the wait is preserved for elements that actually exist.
    assert.match(actionsSrc, /if \(await locator\.count\(\) === 0\) continue;/);
    assert.match(actionsSrc, /boundingBox\(\{ timeout: 250 \}\)/);
});

test('LP-007b: the measurement budget can actually reach the node cap', () => {
    // The cap and the budget are one contract, and pairing 500 nodes with 5s
    // left the cap unreachable: measured p50 on a real article is ~11ms, not
    // the ~2ms a page of trivial buttons suggests, so a full capture ran 5219ms
    // and truncated by deadline on exactly the pages the larger cap was meant
    // to cover. Raising one without the other just moves where the signal
    // becomes constantly true.
    const limit = Number(/opts\.limit \?\? (\d+)/.exec(actionsSrc)?.[1]);
    const budget = Number(/opts\.budgetMs \?\? (\d+)/.exec(actionsSrc)?.[1]);
    assert.ok(Number.isFinite(limit) && Number.isFinite(budget), 'both defaults are readable');
    const measuredP50Ms = 11;
    assert.ok(
        budget >= limit * measuredP50Ms,
        `a ${limit}-node capture needs about ${limit * measuredP50Ms}ms at the measured p50, but the budget is ${budget}ms`,
    );
});

test('LP-008: a partial capture withdraws the uniqueness claim, and only that', () => {
    // A missing box cannot create ambiguity but can dissolve it, so
    // "exactly one element contains this point" is the conclusion at risk.
    assert.match(visionSrc, /boxesTruncated && decision\?\.action === 'ref' && decision\.reason === 'candidate_center_inside_ref_box'/);
    assert.match(visionSrc, /COMPUTER_GEOMETRY_TRUNCATED/);
});

test('LP-008b: a coordinate fallback is NOT refused on a partial capture', () => {
    // "No ref box here" is the correct answer for canvas, WebGL and
    // cross-origin iframes, and truncation at some unrelated node says nothing
    // about whether a box exists at THIS point. Refusing there was tried and
    // withdrawn: it declined every coordinate click on any page large enough
    // to truncate — the same over-refusal the coordinate hit test was dropped
    // for, arriving by a different road.
    assert.doesNotMatch(visionSrc, /'no-element'/);
    assert.doesNotMatch(visionSrc, /absenceConclusion/);
    const refusal = visionSrc.slice(
        visionSrc.indexOf('COMPUTER_GEOMETRY_TRUNCATED') - 900,
        visionSrc.indexOf('COMPUTER_GEOMETRY_TRUNCATED') + 200,
    );
    assert.doesNotMatch(refusal, /decision\?\.action === 'coordinate'/);
});

test('LP-009: truncation is reported even when the click goes ahead', () => {
    assert.match(visionSrc, /truncated: boxesTruncated,/);
});

test('LP-010: the coordinate path did not get a hit test that cannot refuse', () => {
    // judgeHit returns 'unknown' whenever relatesToTarget is undefined, and
    // that is set only when a targetPoint was supplied. With no reconciled box
    // there is no such point, so a hit test there would add a round-trip and
    // the appearance of a guard — the exact failure occlusion.ts's own header
    // documents. It was implemented in this phase and withdrawn.
    const coordinateBlock = visionSrc.slice(visionSrc.indexOf('// 4. Click'));
    assert.doesNotMatch(coordinateBlock, /hitTestPoint/);
});

// ─── the fixture that actually exercises the bug ────────────────────────

test('LP-011: a fixture case has the containing name FIRST', () => {
    // similar-name passes by accident: Save precedes Save as, so a substring
    // locator for Save resolves to Save anyway. Reversed order is what the
    // defect needs.
    const html = fs.readFileSync(join(root, 'tests/fixtures/grounding/grounding-basic.html'), 'utf8');
    const allAt = html.indexOf('id="export-all"');
    const oneAt = html.indexOf('id="export"');
    assert.ok(allAt > 0 && oneAt > 0, 'both buttons exist');
    assert.ok(allAt < oneAt, 'the containing name must come first or the case proves nothing');

    const cases = JSON.parse(fs.readFileSync(join(root, 'tests/fixtures/grounding/cases.json'), 'utf8'));
    const c = cases.cases.find((x: { id: string }) => x.id === 'contained-name');
    assert.ok(c, 'the case is declared');
    assert.equal(c.expected, 'export');
});
// ─── what truncation actually costs the decision ────────────────────────

const box = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });
const namedRef = (n: string, b: ReturnType<typeof box>) => ({ ref: n, role: 'button', name: n, box: b });

test('LP-012: a dropped box turns a refusal into a confident ref click', () => {
    // This is the harm, demonstrated rather than asserted about. The same
    // point, the same page — one capture saw both overlapping elements and one
    // did not.
    const point = { x: 50, y: 25 };
    const whole = reconcileVisionCandidate({
        candidate: { point },
        bundle: { refs: [namedRef('e1', box(0, 0, 100, 50)), namedRef('e2', box(40, 20, 100, 50))] },
    });
    assert.equal(whole.action, 'fail');
    assert.equal(whole.action === 'fail' && whole.code, 'COMPUTER_TARGET_AMBIGUOUS');

    const partial = reconcileVisionCandidate({
        candidate: { point },
        bundle: { refs: [namedRef('e1', box(0, 0, 100, 50))] },
    });
    assert.equal(partial.action, 'ref', 'the ambiguity is gone with the missing box');
    assert.equal(partial.action === 'ref' && partial.reason, 'candidate_center_inside_ref_box');
});

test('LP-013: a dropped box cannot manufacture ambiguity, only dissolve it', () => {
    // The asymmetry is why truncation is a defect rather than a tuning knob:
    // withdrawing the uniqueness claim is the only sound response, because a
    // box we never measured can never be the one that would have refused.
    const point = { x: 500, y: 500 };
    const partial = reconcileVisionCandidate({ candidate: { point }, bundle: { refs: [namedRef('e1', box(0, 0, 100, 50))] } });
    assert.equal(partial.action, 'coordinate', 'a far point still falls back');
    const whole = reconcileVisionCandidate({
        candidate: { point },
        bundle: { refs: [namedRef('e1', box(0, 0, 100, 50)), namedRef('e2', box(600, 600, 50, 50))] },
    });
    assert.equal(whole.action, 'coordinate', 'and adding a box elsewhere does not change that');
});

test('LP-014: a near-miss snap is not a uniqueness claim, so truncation leaves it alone', () => {
    // It resolved to something rather than concluding from the absence of
    // everything else, which is why the refusal is scoped away from it.
    const r = reconcileVisionCandidate({
        candidate: { point: { x: 110, y: 25 } },
        bundle: { refs: [namedRef('e1', box(0, 0, 100, 50))] },
    });
    assert.equal(r.action, 'ref');
    assert.equal(r.action === 'ref' && r.reason, 'candidate_center_near_ref_box');
});

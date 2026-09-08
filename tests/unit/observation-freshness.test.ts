import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertFreshObservationBundle } from '../../src/browser/web-ai/candidate-reconcile.ts';
import { remainingObservationBudget, OBSERVATION_MAX_AGE_MS } from '../../src/browser/verify-candidate.ts';
import {
    classifyFailure,
    ABSTENTION_CODES,
    INFRASTRUCTURE_CODES,
    NOT_FOUND_CODE,
} from '../../src/browser/grounding-eval.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const visionSrc = fs.readFileSync(join(root, 'src/browser/vision.ts'), 'utf8');

// ─── the guard that could not fire ───────────────────────────────────────
//
// assertFreshObservationBundle throws exactly when the page navigated. It used
// to be called inside the reconciliation try/catch, so the one condition that
// must stop a click was swallowed and control fell through to a raw
// coordinate click on a page that no longer existed.

test('OF-001: the freshness assertion is no longer inside the reconcile catch', () => {
    // Structural, but not a source-string guardrail assertion: this pins WHERE
    // a call sits relative to a catch that exists to tolerate failure, which
    // is a property no unit test over pure functions can observe.
    const reconcileBlock = visionSrc.slice(
        visionSrc.indexOf('if (opts.reconcile !== false)'),
        visionSrc.indexOf('if (decision?.action === \'fail\')'),
    );
    assert.ok(reconcileBlock.length > 0, 'the reconcile block should still exist');
    assert.doesNotMatch(
        reconcileBlock,
        /assertFreshObservationBundle/,
        'freshness must not be decided inside the block a caller can switch off',
    );
});

test('OF-002: the freshness decision precedes the reconcile block', () => {
    const freshnessAt = visionSrc.indexOf('assertFreshObservationBundle(observedIdentity');
    const reconcileAt = visionSrc.indexOf('if (opts.reconcile !== false)');
    assert.ok(freshnessAt > 0, 'the freshness call should exist');
    assert.ok(reconcileAt > 0, 'the reconcile block should exist');
    assert.ok(freshnessAt < reconcileAt, 'freshness is decided before, and independently of, reconciliation');
});

test('OF-003: the assertion is called with the observation first and the live page second', () => {
    // The old call passed the FRESH boxes as `bundle` and the OLD probe as
    // `current`, inverted against the contract. Inequality made the outcome
    // identical, so nothing failed — it just read as an assertion about the
    // wrong thing.
    assert.match(visionSrc, /assertFreshObservationBundle\(observedIdentity,/);
});

test('OF-004: a changed URL and a changed targetId both refuse', () => {
    assert.throws(
        () => assertFreshObservationBundle({ url: 'https://a/1' }, { url: 'https://a/2' }),
        /COMPUTER_OBSERVATION_STALE/,
    );
    assert.throws(
        () => assertFreshObservationBundle({ targetId: 'T1' }, { targetId: 'T2' }),
        /COMPUTER_OBSERVATION_STALE/,
    );
});

test('OF-005: an absent side is not a mismatch', () => {
    // observePageIdentity returning null means UNKNOWN, not changed. A probe
    // that failed says nothing about the page, and refusing every click on a
    // failed diagnostic would be a denial of service of our own making.
    assert.doesNotThrow(() => assertFreshObservationBundle({}, { url: 'https://a/1' }));
    assert.doesNotThrow(() => assertFreshObservationBundle({ url: 'https://a/1' }, {}));
});

test('OF-006: unreadable identity is reported rather than assumed', () => {
    assert.match(visionSrc, /freshness: 'verified' \| 'unknown'/);
    assert.match(visionSrc, /freshness,/);
});

// ─── refusing before paying ──────────────────────────────────────────────

test('OF-007: expiry is checked before the verification round-trip starts', () => {
    const verifyAt = visionSrc.indexOf('if (opts.verifyBeforeClick)');
    const secondSpawnAt = visionSrc.indexOf('const second = await extractCoordinates');
    const earlyCheck = visionSrc.slice(verifyAt, secondSpawnAt);
    assert.match(earlyCheck, /isObservationStale\(observedAt/);
});

test('OF-008: the remaining budget never exceeds the cap or goes negative', () => {
    const t0 = 1_000_000;
    assert.equal(remainingObservationBudget(t0, t0, 60_000), Math.min(60_000, OBSERVATION_MAX_AGE_MS));
    assert.equal(remainingObservationBudget(t0, t0 + 10_000, 60_000), OBSERVATION_MAX_AGE_MS - 10_000);
    assert.equal(remainingObservationBudget(t0, t0 + OBSERVATION_MAX_AGE_MS + 5_000, 60_000), 0);
});

test('OF-009: the cap still bounds a budget larger than it', () => {
    const t0 = 1_000_000;
    assert.equal(remainingObservationBudget(t0, t0, 5_000), 5_000, 'a smaller cap wins');
    assert.equal(remainingObservationBudget(t0, t0, 60_000, 120_000), 60_000, 'a larger budget does not raise the cap');
});

test('OF-010: an unusable clock yields no budget rather than an infinite one', () => {
    const t0 = 1_000_000;
    assert.equal(remainingObservationBudget(Number.NaN, t0, 60_000), 0);
    assert.equal(remainingObservationBudget(t0, Number.NaN, 60_000), 0);
    assert.equal(remainingObservationBudget(t0, t0 - 1, 60_000), 0, 'time running backwards is not budget');
});

test('OF-011: the provider timeout is derived from the budget, not a constant', () => {
    assert.match(visionSrc, /timeoutMs: remainingObservationBudget\(observedAt/);
    assert.doesNotMatch(visionSrc, /timeout: 60000/, 'the flat spawn timeout is gone');
});

// ─── codes that mean something at both ends ──────────────────────────────

test('OF-012: every failure return carries a code', () => {
    // The five returns that used to carry a reason and nothing else. The CLI
    // printed them as "not found" and the harness scored them as abstentions,
    // so an infrastructure failure read as commendable restraint.
    for (const code of [
        'COMPUTER_TARGET_NOT_FOUND',
        'COMPUTER_CAPTURE_UNMEASURABLE',
        'COMPUTER_CANDIDATE_OUT_OF_BOUNDS',
        'COMPUTER_VIEWPORT_UNAVAILABLE',
        'COMPUTER_CAPTURE_NO_DPR',
    ]) {
        assert.match(visionSrc, new RegExp(code), `${code} should be emitted`);
    }
});

test('OF-013: the three failure meanings are distinguishable', () => {
    assert.equal(classifyFailure('COMPUTER_TARGET_COVERED'), 'abstention');
    assert.equal(classifyFailure('COMPUTER_OBSERVATION_STALE'), 'abstention');
    assert.equal(classifyFailure(NOT_FOUND_CODE), 'not-found');
    assert.equal(classifyFailure('COMPUTER_CAPTURE_NO_DPR'), 'infrastructure');
    assert.equal(classifyFailure(null), 'unknown');
    assert.equal(classifyFailure('COMPUTER_SOMETHING_NEW'), 'unknown');
});

test('OF-014: the code sets do not overlap', () => {
    for (const code of INFRASTRUCTURE_CODES) {
        assert.ok(!ABSTENTION_CODES.has(code), `${code} cannot be both a refusal and a failure`);
    }
    assert.ok(!ABSTENTION_CODES.has(NOT_FOUND_CODE), 'not-found is its own claim');
    assert.ok(!INFRASTRUCTURE_CODES.has(NOT_FOUND_CODE));
});

test('OF-015: the CLI branches on meaning, not on the presence of a code', () => {
    const cliSrc = fs.readFileSync(join(root, 'bin/commands/browser.ts'), 'utf8');
    assert.match(cliSrc, /classifyFailure\(code\)/);
    assert.match(cliSrc, /kind === 'abstention'/);
    assert.match(cliSrc, /kind === 'infrastructure'/);
});

// ─── symmetry ────────────────────────────────────────────────────────────

test('OF-016: the verification capture fails closed on an unmeasurable image, like the main path', () => {
    const verifyBlock = visionSrc.slice(
        visionSrc.indexOf('if (opts.verifyBeforeClick)'),
        visionSrc.indexOf('const clickPoint ='),
    );
    assert.match(verifyBlock, /!cropShot\.image/);
});

test('OF-017: verification judges against the captured crop, not the requested one', () => {
    assert.match(visionSrc, /judgeVerification\(local, cropShot\.clip \?\? crop, css\)/);
});


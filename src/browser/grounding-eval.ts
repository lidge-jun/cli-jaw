/**
 * src/browser/grounding-eval.ts — scoring for the grounding harness.
 *
 * Every phase in this work shipped on unit evidence with the same admitted
 * gap: the pipeline seam needs a live browser and a model spawn, so nothing
 * measured whether grounding actually works. This is the scoring half of the
 * thing that measures it. The runner is separate and lives in scripts/, so the
 * arithmetic here stays testable without Chrome.
 *
 * The measurement that matters is NOT "did the call return success". A click
 * that lands on the wrong element also returns success, which is the failure
 * this whole stack was opened to address. So a case declares the element it
 * expects, and a run is scored against what was actually clicked.
 *
 * Abstention is a first-class outcome, not a failure. Refusing an ambiguous
 * target, an occluded one, or a stale observation is the pipeline working.
 * Folding those into "failed" would make every guard look like a regression
 * and reward a system that clicks confidently regardless.
 */

export type CaseOutcome =
    /** Clicked, and it was the expected element. */
    | { kind: 'verified'; ms: number }
    /** Clicked, but not the expected element. The outcome worth minimising. */
    | { kind: 'misclick'; ms: number; got: string }
    /** Declined to click, with a reason. Correct behaviour when unsure. */
    | { kind: 'abstained'; ms: number; reason: string }
    /**
     * Did not click, and declining was not the right answer either.
     *
     * The element was there, it was described, and the pipeline could not
     * ground it — or it returned a point outside the frame it was shown. That
     * is a failure of the thing being measured, and it is neither of the two
     * outcomes it used to be filed under. Calling it an abstention credits the
     * pipeline with restraint it did not exercise; calling it an error blames
     * the harness for a defect in the pipeline. It stays in the denominator.
     */
    | { kind: 'grounding-failure'; ms: number; reason: string }
    /** The harness could not run the case. Not evidence either way. */
    | { kind: 'errored'; ms: number; error: string };

export type CaseResult = { id: string; expected: string; outcome: CaseOutcome };

/**
 * Some cases expect the pipeline to DECLINE — an occluded target, an ambiguous
 * one, a target that is not on the page. Those are scored inverted: an
 * abstention is correct and a confident click is the misclick.
 *
 * They are counted separately as well as together, because a single blended
 * rate is ambiguous: 80% could mean the pipeline clicks accurately, or that it
 * refuses reliably, or any mixture. Those are different claims.
 */
export type ScoredGroup = {
    scored: number;
    verified: number;
    misclicked: number;
    abstained: number;
    groundingFailed: number;
    verifiedRate: number;
    misclickRate: number;
};

export type EvalReport = {
    total: number;
    /** Cases the harness could actually score. */
    scored: number;
    verified: number;
    misclicked: number;
    abstained: number;
    errored: number;
    /** Cases the pipeline failed to ground when grounding was the answer. */
    groundingFailed: number;
    /**
     * Scoped to click cases, like every other rate here.
     *
     * A blended rate cannot be read: a refusal-case misclick means "clicked
     * when it should have declined" and a click-case misclick means "clicked
     * the wrong element". Summing them produced one number meaning two
     * different failures with different remedies — the same defect that was
     * already found and fixed for `abstentionRate` alone, one field away.
     */
    verifiedRate: number;
    /** The number to watch: a wrong click is worse than no click. */
    misclickRate: number;
    /**
     * Refusals on cases where CLICKING was the correct answer.
     *
     * Deliberately not "all abstentions": on a refusal-expected case a decline
     * is the right answer and is counted as verified, so blending the two
     * would mix "the pipeline declined when it should have acted" with "the
     * pipeline declined when it should have declined". Those are opposite
     * signals wearing the same name.
     */
    abstentionRate: number;
    latency: { p50: number; p95: number; max: number } | null;
    /** Cases where clicking the named element is correct. */
    click: ScoredGroup;
    /** Cases where declining is correct. */
    refusal: ScoredGroup;
    /**
     * What actually went wrong on the cases the harness could not run.
     *
     * A bare count leaves the operator correlating a number against the
     * per-case lines above it. Distinct strings, because ten cases failing for
     * one reason is a different situation from ten failing for ten.
     */
    errors: string[];
};

/**
 * Percentile by nearest-rank on a sorted sample.
 *
 * Deliberately not interpolating: with a handful of cases an interpolated p95
 * reports a duration that never happened, which reads as precision the sample
 * does not have.
 */
export function percentile(sortedMs: number[], p: number): number {
    if (sortedMs.length === 0) return 0;
    const rank = Math.ceil((p / 100) * sortedMs.length);
    const index = Math.min(Math.max(rank, 1), sortedMs.length) - 1;
    return sortedMs[index] as number;
}

export function scoreRun(results: CaseResult[]): EvalReport {
    const counts = { verified: 0, misclicked: 0, abstained: 0, groundingFailed: 0, errored: 0 };
    const durations: number[] = [];
    const group = (): ScoredGroup => ({ scored: 0, verified: 0, misclicked: 0, abstained: 0, groundingFailed: 0, verifiedRate: 0, misclickRate: 0 });
    const click = group();
    const refusal = group();
    const errors = new Set<string>();

    for (const r of results) {
        // `expected: 'abstain'` marks a case whose correct answer is a refusal.
        const bucket = r.expected === 'abstain' ? refusal : click;
        switch (r.outcome.kind) {
            case 'verified': counts.verified += 1; bucket.verified += 1; bucket.scored += 1; break;
            case 'misclick': counts.misclicked += 1; bucket.misclicked += 1; bucket.scored += 1; break;
            case 'abstained': counts.abstained += 1; bucket.abstained += 1; bucket.scored += 1; break;
            // A grounding failure stays in the denominator. It is a defect in
            // the thing being measured, so excluding it would let a pipeline
            // that grounds nothing report a clean sheet.
            case 'grounding-failure': counts.groundingFailed += 1; bucket.groundingFailed += 1; bucket.scored += 1; break;
            case 'errored': counts.errored += 1; errors.add(r.outcome.error); break;
        }
        // An errored case measures the harness, not the pipeline, so its
        // duration would skew the latency picture.
        if (r.outcome.kind !== 'errored') durations.push(r.outcome.ms);
    }

    // Errors are excluded from the denominator. A case the harness could not
    // run is not evidence that grounding failed, and counting it as one would
    // let a broken fixture look like a regression.
    const scored = counts.verified + counts.misclicked + counts.abstained + counts.groundingFailed;
    durations.sort((a, b) => a - b);
    for (const g of [click, refusal]) {
        g.verifiedRate = g.scored === 0 ? 0 : g.verified / g.scored;
        g.misclickRate = g.scored === 0 ? 0 : g.misclicked / g.scored;
    }

    return {
        total: results.length,
        scored,
        ...counts,
        // All three headline rates are scoped to click cases. Blending them
        // with refusal cases produced numbers that could not be read.
        verifiedRate: click.verifiedRate,
        misclickRate: click.misclickRate,
        abstentionRate: click.scored === 0 ? 0 : click.abstained / click.scored,
        latency: durations.length
            ? { p50: percentile(durations, 50), p95: percentile(durations, 95), max: durations[durations.length - 1] as number }
            : null,
        click,
        refusal,
        errors: [...errors],
    };
}

/**
 * Decide a case outcome from what the pipeline returned.
 *
 * The refusal codes are named rather than pattern-matched on prose, so a
 * reworded message cannot silently reclassify a refusal as a failure.
 */
export const ABSTENTION_CODES = new Set([
    'COMPUTER_TARGET_AMBIGUOUS',
    'COMPUTER_TARGET_COVERED',
    'COMPUTER_VERIFY_DISAGREED',
    'COMPUTER_OBSERVATION_EXPIRED',
    'COMPUTER_OBSERVATION_STALE',
    // Declining because the geometry was only partly captured, so a single
    // containing element could not be concluded safely. A refusal, not a
    // failure: the pipeline knew what it did not know.
    'COMPUTER_GEOMETRY_TRUNCATED',
]);

/**
 * The pipeline looked and did not find it.
 *
 * Separate from the abstention codes above because it is a different claim:
 * those say "I found something and declined to act", this says "there was
 * nothing to act on". A reader chasing a missing button needs to know which.
 */
export const NOT_FOUND_CODE = 'COMPUTER_TARGET_NOT_FOUND';

/**
 * The call could not be completed for reasons that have nothing to do with
 * the page: a capture that could not be measured, a viewport that could not be
 * read, a scale factor that was absent.
 *
 * These used to arrive with no code at all, which made them indistinguishable
 * from a refusal — an infrastructure failure scored as commendable restraint,
 * and printed to a human as a missing element.
 */
export const INFRASTRUCTURE_CODES = new Set([
    'COMPUTER_CAPTURE_UNMEASURABLE',
    'COMPUTER_VIEWPORT_UNAVAILABLE',
    'COMPUTER_CAPTURE_NO_DPR',
]);

/**
 * The pipeline produced an answer that was wrong on its face.
 *
 * `COMPUTER_CANDIDATE_OUT_OF_BOUNDS` fires when the model returns a point
 * outside the frame it was shown. That is a defect in the thing being
 * measured, not in the environment measuring it — grouping it with the
 * capture failures would take a real grounding defect out of the denominator
 * and blame the harness for it.
 */
export const GROUNDING_FAILURE_CODES = new Set([
    'COMPUTER_CANDIDATE_OUT_OF_BOUNDS',
]);

/** What a failed vision-click actually was, for callers that must say so. */
export type FailureKind =
    | 'abstention'
    | 'not-found'
    | 'grounding-failure'
    | 'infrastructure'
    /** A `success:false` body with no code at all — a protocol violation. */
    | 'uncoded'
    /** A code this build does not recognise. Forward compatibility, not breakage. */
    | 'unknown';

export function classifyFailure(code: string | null | undefined): FailureKind {
    // An absent code and an unrecognised one are different situations. The
    // first says the responder does not speak this protocol — an older server,
    // most likely, since this runner talks to a separately built one over
    // HTTP. The second says it speaks a newer dialect. Collapsing them would
    // let a version skew silently reinstate the mis-scoring this fixes.
    if (!code) return 'uncoded';
    if (ABSTENTION_CODES.has(code)) return 'abstention';
    if (code === NOT_FOUND_CODE) return 'not-found';
    if (GROUNDING_FAILURE_CODES.has(code)) return 'grounding-failure';
    if (INFRASTRUCTURE_CODES.has(code)) return 'infrastructure';
    return 'unknown';
}

export function classify(
    response: { success?: boolean; code?: string; reason?: string; ref?: string },
    expected: string,
    ms: number,
    clickedRef?: string,
): CaseOutcome {
    if (response.success !== true) {
        const kind = classifyFailure(response.code);
        if (kind === 'abstention') {
            return { kind: 'abstained', ms, reason: response.code as string };
        }
        if (kind === 'infrastructure') {
            // The harness could not ask the question. That is not evidence
            // about grounding in either direction, and scoring it as
            // restraint made a broken capture look like good judgement.
            return { kind: 'errored', ms, error: response.code as string };
        }
        if (kind === 'grounding-failure') {
            return { kind: 'grounding-failure', ms, reason: response.code as string };
        }
        if (kind === 'not-found') {
            // Expected-aware, because the same code means opposite things.
            // On a case that should have declined, not finding the target IS
            // the right answer. On a case where the element is present and
            // described, failing to find it is a grounding failure — filing it
            // as an abstention credits restraint that was never exercised and
            // keeps it out of the misclick denominator, so a pipeline that
            // grounds nothing reports a clean sheet.
            return expected === 'abstain'
                ? { kind: 'abstained', ms, reason: response.code as string }
                : { kind: 'grounding-failure', ms, reason: response.code as string };
        }
        if (kind === 'uncoded' && response.reason) {
            // A `success:false` body carrying prose and no code. Every current
            // source path names its failures, so this means the responder is
            // older than the naming — which is exactly the case where the
            // prose could be describing a capture failure. Scoring it as an
            // abstention is the mistake this function was rewritten to stop,
            // so it is surfaced as unscoreable rather than credited.
            return { kind: 'errored', ms, error: `uncoded failure: ${response.reason}` };
        }
        // An unrecognised code is forward compatibility, not breakage: this
        // build cannot judge a dialect it does not know, and hard-failing
        // would make the harness brittle against its own future.
        if (response.reason) return { kind: 'abstained', ms, reason: response.reason };
        return { kind: 'errored', ms, error: 'no reason given' };
    }

    const got = clickedRef ?? response.ref;
    // Success without an identifiable target cannot be scored. Calling it
    // verified would be the exact assumption this harness exists to test.
    if (!got) return { kind: 'errored', ms, error: 'clicked but no element identity was reported' };
    return got === expected ? { kind: 'verified', ms } : { kind: 'misclick', ms, got };
}

/** One line per rate, plus the caveat the numbers need to be read with. */
export function formatReport(report: EvalReport): string {
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    const lines = [
        `cases           ${report.total} (${report.scored} scored, ${report.errored} errored)`,
        `verified        ${report.verified} (${pct(report.verifiedRate)})`,
        `misclicked      ${report.misclicked} (${pct(report.misclickRate)})`,
        `abstained       ${report.abstained} (${pct(report.abstentionRate)} of cases that should have clicked)`,
    ];
    if (report.groundingFailed > 0) {
        lines.push(`not grounded    ${report.groundingFailed} (the target was there and the pipeline could not find it)`);
    }
    if (report.latency) {
        lines.push(`latency         p50 ${report.latency.p50}ms  p95 ${report.latency.p95}ms  max ${report.latency.max}ms`);
    }
    lines.push(
        '',
        `when clicking   ${report.click.verified}/${report.click.scored} right, ${report.click.misclicked} wrong`,
        `when refusing   ${report.refusal.verified}/${report.refusal.scored} correctly declined, ${report.refusal.misclicked} clicked anyway`,
    );
    if (report.errors.length > 0) {
        lines.push('', 'could not be scored:');
        for (const e of report.errors) lines.push(`  ${e}`);
    }
    lines.push('', 'An abstention is the pipeline declining, not failing. Read the misclick', 'rate first: a wrong click is worse than no click.');
    return lines.join('\n');
}

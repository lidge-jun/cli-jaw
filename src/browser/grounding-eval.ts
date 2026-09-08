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
    /** Of scored cases. A misclick costs the same as an abstention here. */
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
    const counts = { verified: 0, misclicked: 0, abstained: 0, errored: 0 };
    const durations: number[] = [];
    const group = (): ScoredGroup => ({ scored: 0, verified: 0, misclicked: 0, abstained: 0, verifiedRate: 0, misclickRate: 0 });
    const click = group();
    const refusal = group();

    for (const r of results) {
        // `expected: 'abstain'` marks a case whose correct answer is a refusal.
        const bucket = r.expected === 'abstain' ? refusal : click;
        switch (r.outcome.kind) {
            case 'verified': counts.verified += 1; bucket.verified += 1; bucket.scored += 1; break;
            case 'misclick': counts.misclicked += 1; bucket.misclicked += 1; bucket.scored += 1; break;
            case 'abstained': counts.abstained += 1; bucket.abstained += 1; bucket.scored += 1; break;
            case 'errored': counts.errored += 1; break;
        }
        // An errored case measures the harness, not the pipeline, so its
        // duration would skew the latency picture.
        if (r.outcome.kind !== 'errored') durations.push(r.outcome.ms);
    }

    // Errors are excluded from the denominator. A case the harness could not
    // run is not evidence that grounding failed, and counting it as one would
    // let a broken fixture look like a regression.
    const scored = counts.verified + counts.misclicked + counts.abstained;
    const rate = (n: number) => (scored === 0 ? 0 : n / scored);
    durations.sort((a, b) => a - b);
    for (const g of [click, refusal]) {
        g.verifiedRate = g.scored === 0 ? 0 : g.verified / g.scored;
        g.misclickRate = g.scored === 0 ? 0 : g.misclicked / g.scored;
    }

    return {
        total: results.length,
        scored,
        ...counts,
        verifiedRate: rate(counts.verified),
        misclickRate: rate(counts.misclicked),
        // Scoped to click cases, per the field's own contract above.
        abstentionRate: click.scored === 0 ? 0 : click.abstained / click.scored,
        latency: durations.length
            ? { p50: percentile(durations, 50), p95: percentile(durations, 95), max: durations[durations.length - 1] as number }
            : null,
        click,
        refusal,
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
]);

export function classify(
    response: { success?: boolean; code?: string; reason?: string; ref?: string },
    expected: string,
    ms: number,
    clickedRef?: string,
): CaseOutcome {
    if (response.success !== true) {
        if (response.code && ABSTENTION_CODES.has(response.code)) {
            return { kind: 'abstained', ms, reason: response.code };
        }
        // "Target not found" is also an abstention: the pipeline declined
        // rather than clicked, which is the behaviour being measured.
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
    if (report.latency) {
        lines.push(`latency         p50 ${report.latency.p50}ms  p95 ${report.latency.p95}ms  max ${report.latency.max}ms`);
    }
    lines.push(
        '',
        `when clicking   ${report.click.verified}/${report.click.scored} right, ${report.click.misclicked} wrong`,
        `when refusing   ${report.refusal.verified}/${report.refusal.scored} correctly declined`,
    );
    lines.push('', 'An abstention is the pipeline declining, not failing. Read the misclick', 'rate first: a wrong click is worse than no click.');
    return lines.join('\n');
}

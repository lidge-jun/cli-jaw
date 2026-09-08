import test from 'node:test';
import assert from 'node:assert/strict';
import type { CodeContextUsage } from '../../src/code-mode/wire.ts';
import { contextUsageLabel, contextUsageLevel, contextUsageView, formatExactTokens,
    formatOptionalTokens, formatTokens } from '../../public/manager/src/code/context-usage.ts';

function usage(patch: Partial<CodeContextUsage> = {}): CodeContextUsage {
    return { totalTokens: 1000, inputTokens: 800, cachedInputTokens: 200, outputTokens: 200,
        reasoningOutputTokens: 0, processedTokens: 4000, modelContextWindow: 10000, updatedAt: 1, ...patch };
}

test('a reported window gives a proportion, and no window gives only a count', () => {
    assert.deepEqual(contextUsageView(usage()), { state: 'measured', usedTokens: 1000, maxTokens: 10000, percent: 10, over: false });
    // A proportion of an unknown total is not a proportion, so the count stands
    // alone rather than being turned into a percentage of something guessed.
    assert.deepEqual(contextUsageView(usage({ modelContextWindow: null })), { state: 'counted', usedTokens: 1000 });
    assert.deepEqual(contextUsageView(usage({ modelContextWindow: 0 })), { state: 'counted', usedTokens: 1000 });
});

test('nothing reported renders nothing, rather than a zero that reads as measured', () => {
    assert.deepEqual(contextUsageView(undefined), { state: 'hidden' });
    assert.deepEqual(contextUsageView(usage({ totalTokens: Number.NaN })), { state: 'hidden' });
    assert.deepEqual(contextUsageView(usage({ totalTokens: -1 })), { state: 'hidden' });
    // Zero used tokens IS a measurement, and differs from no measurement.
    assert.deepEqual(contextUsageView(usage({ totalTokens: 0 })), { state: 'measured', usedTokens: 0, maxTokens: 10000, percent: 0, over: false });
});

test('past the window the ring caps but the label does not pretend it is full', () => {
    // Reachable when a model change moves the window under a conversation that
    // is already large. The ring cannot draw past full, but silently capping
    // would make a wrong number look exactly like a genuinely full context --
    // which is how a lifetime-spend figure would have hidden here.
    const over = contextUsageView(usage({ totalTokens: 11800 }));
    assert.deepEqual(over, { state: 'measured', usedTokens: 11800, maxTokens: 10000, percent: 100, over: true });
    assert.match(contextUsageLabel(over), /over the window, 12k of 10k tokens/);
    assert.doesNotMatch(contextUsageLabel(over), /100% used/, 'a self-contradictory label is worse than none');
});

test('thresholds are named where attention starts', () => {
    assert.equal(contextUsageLevel(74), 'normal');
    assert.equal(contextUsageLevel(75), 'high');
    assert.equal(contextUsageLevel(89), 'high');
    assert.equal(contextUsageLevel(90), 'critical');
    assert.equal(contextUsageLevel(100), 'critical');
});

test('counts stay short, and an unreported part stays absent', () => {
    assert.equal(formatTokens(0), '0');
    assert.equal(formatTokens(999), '999');
    assert.equal(formatTokens(1000), '1.0k');
    assert.equal(formatTokens(12400), '12k');
    assert.equal(formatTokens(1_250_000), '1.3M');
    assert.equal(formatOptionalTokens(null), '—', 'a field the runtime did not report is not zero');
    assert.equal(formatOptionalTokens(0), '0');
});

test('each unit is chosen after its own rounding, so no boundary produces a wrong one', () => {
    // 999.5 rounds to 1000, which is not the bare small number that branch is
    // for; 999,999 in thousands rounds to 1000, which would be a four-digit
    // "k" where the answer is "1.0M".
    assert.equal(formatTokens(999.5), '1.0k');
    assert.equal(formatTokens(999_999), '1.0M');
    assert.equal(formatTokens(999_499), '999k');
    assert.equal(formatTokens(9_949), '9.9k');
    assert.equal(formatTokens(10_000), '10k');
    assert.equal(formatTokens(2_258_818), '2.3M');
});

test('the detail carries the count the trigger had to round away', () => {
    // A reader cannot get from "12k" back to the number the percentage was
    // computed from, and near a threshold that difference is the whole point.
    assert.equal(formatExactTokens(12_400), '12,400');
    assert.equal(formatExactTokens(134_904), '134,904');
    assert.equal(formatExactTokens(null), '—');
    assert.equal(formatExactTokens(Number.NaN), '—');
});

test('the accessible name says what the ring cannot', () => {
    assert.match(contextUsageLabel(contextUsageView(usage())), /10% used, 1\.0k of 10k tokens/);
    assert.match(contextUsageLabel(contextUsageView(usage({ modelContextWindow: null }))), /window unknown/);
    assert.equal(contextUsageLabel(contextUsageView(undefined)), '');
});

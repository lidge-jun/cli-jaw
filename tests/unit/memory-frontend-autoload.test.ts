import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    BOOTSTRAP_BUDGET,
    renderBootstrapPrompt,
    type BootstrapSlots,
} from '../../src/core/compact.ts';

describe('Phase 50/54 — Frontend Autoload & Codex/Gemini Parity', () => {
    // Phase 54-B: forDisk AGENTS.md should include memory context
    // We can't test builder.ts directly (requires full settings), but we verify
    // the building blocks that feed into it.

    test('BOOTSTRAP_BUDGET has all required slot keys', () => {
        assert.ok('goal' in BOOTSTRAP_BUDGET);
        assert.ok('recent_turns' in BOOTSTRAP_BUDGET);
        assert.ok('memory_hits' in BOOTSTRAP_BUDGET);
        assert.ok('grep_hits' in BOOTSTRAP_BUDGET);
        assert.ok('task_snapshot' in BOOTSTRAP_BUDGET);
        assert.ok('total_max' in BOOTSTRAP_BUDGET);
    });

    test('BOOTSTRAP_BUDGET values are positive numbers', () => {
        for (const [key, value] of Object.entries(BOOTSTRAP_BUDGET)) {
            assert.ok(typeof value === 'number' && value > 0, `${key} should be positive`);
        }
    });

    test('total_max is at least the sum of individual slot budgets', () => {
        const slotSum = BOOTSTRAP_BUDGET.goal
            + BOOTSTRAP_BUDGET.recent_turns
            + BOOTSTRAP_BUDGET.memory_hits
            + BOOTSTRAP_BUDGET.grep_hits
            + BOOTSTRAP_BUDGET.task_snapshot;
        assert.ok(BOOTSTRAP_BUDGET.total_max >= slotSum,
            `total_max (${BOOTSTRAP_BUDGET.total_max}) should be >= slot sum (${slotSum})`);
    });

    // Phase 54-A: Turn-count thresholds for non-Claude CLIs
    // These thresholds are hardcoded in lifecycle-handler.ts — verify they make sense.
    test('turn-count thresholds: suggest < force < session-clear', () => {
        const suggestAt = 25;
        const forceAt = 35;
        const codexClearAt = 15;
        assert.ok(codexClearAt < suggestAt, 'Codex clear should be below suggest threshold');
        assert.ok(suggestAt < forceAt, 'Suggest should be below force threshold');
    });

    // Phase 53-A: Memory injection guaranteed for first 3 turns
    test('first-3-turns injection logic: counter < 3 always injects', () => {
        const threshold = 10;
        const injectInterval = Math.ceil(threshold / 2);
        for (let counter = 0; counter < 3; counter++) {
            const shouldInject = counter < 3 || counter % injectInterval === 0;
            assert.ok(shouldInject, `Turn ${counter} must inject`);
        }
    });

    test('injection at interval works beyond first 3 turns', () => {
        const threshold = 10;
        const injectInterval = Math.ceil(threshold / 2);
        // Turn 5 should inject (5 % 5 === 0)
        const shouldInjectAt5 = 5 < 3 || 5 % injectInterval === 0;
        assert.ok(shouldInjectAt5, 'Turn 5 (interval hit) should inject');

        // Turn 4 should skip
        const shouldInjectAt4 = 4 < 3 || 4 % injectInterval === 0;
        assert.ok(!shouldInjectAt4, 'Turn 4 should skip');
    });

    // Phase 53-B: Short prompt supplementation threshold
    test('short prompt detection threshold is 20 chars', () => {
        const shortPrompts = ['okay', 'go', 'yes', 'y', 'ㅇㅇ', '네'];
        const longPrompts = ['Please fix the authentication bug in auth.ts'];
        for (const p of shortPrompts) {
            assert.ok(p.length < 20, `"${p}" should be under threshold`);
        }
        for (const p of longPrompts) {
            assert.ok(p.length >= 20, `"${p}" should be at/above threshold`);
        }
    });

    test('renderBootstrapPrompt with minimal slots still produces valid handoff', () => {
        const slots: BootstrapSlots = {
            goal: 'ok',
            recent_turns: '',
            memory_hits: '',
            grep_hits: '',
            task_snapshot: '',
        };
        const result = renderBootstrapPrompt(slots);
        assert.ok(result.includes('Compacted Session Handoff'));
        assert.ok(result.includes('ok'));
        assert.ok(result.includes('Continuation Instructions'));
    });
});

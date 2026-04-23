import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    BOOTSTRAP_TRACE_PREFIX,
    COMPACT_MARKER_CONTENT,
    MANAGED_COMPACT_PREFIX,
    isCompactMarkerRow,
    renderBootstrapPrompt,
    BOOTSTRAP_BUDGET,
    type BootstrapSlots,
} from '../../src/core/compact.ts';

describe('Phase 53 — Context Continuity', () => {
    // Phase 53-C: harvestRecentTurns expanded clip limits
    test('renderBootstrapPrompt preserves recent_turns content up to budget', () => {
        const longTurn = 'A'.repeat(700);
        const slots: BootstrapSlots = {
            goal: 'Test context continuity',
            recent_turns: `- [user] ${longTurn}\n- [assistant] ${longTurn}`,
            memory_hits: '',
            grep_hits: '',
            task_snapshot: '',
        };
        const result = renderBootstrapPrompt(slots);
        assert.ok(result.includes('<recent_actions>'));
        assert.ok(result.includes('[user]'));
        assert.ok(result.includes('[assistant]'));
    });

    test('renderBootstrapPrompt includes all non-empty slots', () => {
        const slots: BootstrapSlots = {
            goal: 'Deploy the feature',
            recent_turns: '- [user] approved the plan',
            memory_hits: 'User prefers ES Module',
            grep_hits: '- src/index.ts:1 import something',
            task_snapshot: '## Task Snapshot\nsome context',
        };
        const result = renderBootstrapPrompt(slots);
        assert.ok(result.includes('<overall_goal>'));
        assert.ok(result.includes('Deploy the feature'));
        assert.ok(result.includes('<recent_actions>'));
        assert.ok(result.includes('<key_knowledge>'));
        assert.ok(result.includes('<artifact_trail>'));
        assert.ok(result.includes('<current_state>'));
    });

    test('renderBootstrapPrompt omits empty slots as sections', () => {
        const slots: BootstrapSlots = {
            goal: 'Quick fix',
            recent_turns: '',
            memory_hits: '',
            grep_hits: '',
            task_snapshot: '',
        };
        const result = renderBootstrapPrompt(slots);
        assert.ok(result.includes('<overall_goal>'));
        // Empty slots should not produce section blocks (tag + newline + content + newline + close)
        assert.ok(!result.includes('<recent_actions>\n'));
        assert.ok(!result.includes('<key_knowledge>\n'));
        assert.ok(!result.includes('<artifact_trail>\n'));
        assert.ok(!result.includes('<current_state>\n'));
    });

    test('renderBootstrapPrompt respects total_max budget by trimming older turns', () => {
        const hugeTurns = Array.from({ length: 30 }, (_, i) =>
            `- [user] ${'X'.repeat(400)} message ${i}`
        ).join('\n');
        const slots: BootstrapSlots = {
            goal: 'Budget test',
            recent_turns: hugeTurns,
            memory_hits: 'M'.repeat(1500),
            grep_hits: 'G'.repeat(1000),
            task_snapshot: 'S'.repeat(1500),
        };
        const result = renderBootstrapPrompt(slots);
        assert.ok(result.length <= BOOTSTRAP_BUDGET.total_max + 200,
            `Output ${result.length} should be near total_max ${BOOTSTRAP_BUDGET.total_max}`);
    });

    // Phase 52: Bootstrap compact marker detection
    test('isCompactMarkerRow accepts bootstrap trace prefix', () => {
        assert.equal(isCompactMarkerRow({
            role: 'assistant',
            content: COMPACT_MARKER_CONTENT,
            trace: `${BOOTSTRAP_TRACE_PREFIX}\n<overall_goal>test</overall_goal>`,
        }), true);
    });

    test('isCompactMarkerRow rejects bootstrap trace without correct content', () => {
        assert.equal(isCompactMarkerRow({
            role: 'assistant',
            content: 'Not the marker content',
            trace: `${BOOTSTRAP_TRACE_PREFIX}\npayload`,
        }), false);
    });

    test('renderBootstrapPrompt includes continuation instructions', () => {
        const slots: BootstrapSlots = {
            goal: 'Continue task',
            recent_turns: '- [user] keep going',
            memory_hits: '',
            grep_hits: '',
            task_snapshot: '',
        };
        const result = renderBootstrapPrompt(slots);
        assert.ok(result.includes('Continuation Instructions'));
        assert.ok(result.includes('cli-jaw memory search'));
    });
});

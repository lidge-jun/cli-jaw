import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    COMPACT_MARKER_CONTENT,
    MANAGED_COMPACT_PREFIX,
    BOOTSTRAP_TRACE_PREFIX,
    isCompactMarkerRow,
    getRowsSinceLatestCompactForTest,
    buildManagedCompactSummaryForTest,
} from '../../src/core/compact.ts';

describe('Phase 51 — Compact Race Condition Prevention', () => {
    test('compact marker row detection is precise — no false positives from assistant text', () => {
        // An assistant message that mentions compact but isn't a marker
        assert.equal(isCompactMarkerRow({
            role: 'assistant',
            content: 'I just ran compact and refreshed the session.',
            trace: MANAGED_COMPACT_PREFIX,
        }), false, 'Non-marker content should not match');

        // Correct marker
        assert.equal(isCompactMarkerRow({
            role: 'assistant',
            content: COMPACT_MARKER_CONTENT,
            trace: `${MANAGED_COMPACT_PREFIX}\nfacts`,
        }), true);
    });

    test('back-to-back compact markers: only latest one acts as boundary', () => {
        const marker1 = {
            role: 'assistant',
            content: COMPACT_MARKER_CONTENT,
            trace: `${MANAGED_COMPACT_PREFIX}\nfirst compact`,
        };
        const marker2 = {
            role: 'assistant',
            content: COMPACT_MARKER_CONTENT,
            trace: `${BOOTSTRAP_TRACE_PREFIX}\nsecond compact`,
        };
        const rows = [
            { role: 'user', content: 'after both' },
            marker2,
            { role: 'user', content: 'between compacts' },
            marker1,
            { role: 'user', content: 'before both' },
        ];
        const result = getRowsSinceLatestCompactForTest(rows);
        assert.equal(result.length, 1);
        assert.equal(result[0].content, 'after both');
    });

    test('compact summary strips tool artifacts that could confuse next session', () => {
        const rows = [
            {
                role: 'assistant',
                content: 'Done <tool_call>read file.ts</tool_call> and <tool_result>content here</tool_result> finished.',
            },
            { role: 'user', content: 'Great, now deploy' },
        ];
        const summary = buildManagedCompactSummaryForTest(rows);
        assert.ok(!summary.includes('<tool_call>'), 'tool_call should be stripped');
        assert.ok(!summary.includes('<tool_result>'), 'tool_result should be stripped');
        assert.ok(summary.includes('Done'));
        assert.ok(summary.includes('Great, now deploy'));
    });

    test('managed compact and bootstrap compact have distinct prefixes', () => {
        assert.notEqual(MANAGED_COMPACT_PREFIX, BOOTSTRAP_TRACE_PREFIX);
        assert.ok(MANAGED_COMPACT_PREFIX.startsWith('[assistant]'));
        assert.ok(BOOTSTRAP_TRACE_PREFIX.startsWith('[assistant]'));
    });

    test('empty row list produces a valid summary with fallback message', () => {
        const summary = buildManagedCompactSummaryForTest([]);
        assert.ok(summary.includes(MANAGED_COMPACT_PREFIX));
        assert.ok(summary.includes('No recent user/assistant turns'));
        assert.ok(summary.includes('discard everything else.'));
    });

    test('rows with only tool/system roles are excluded from summary', () => {
        const rows = [
            { role: 'tool', content: 'Tool output data' },
            { role: 'system', content: 'System message' },
            { role: 'user', content: 'Actual user message' },
        ];
        const summary = buildManagedCompactSummaryForTest(rows);
        assert.ok(summary.includes('[user] Actual user message'));
        assert.ok(!summary.includes('Tool output'));
        assert.ok(!summary.includes('System message'));
    });
});

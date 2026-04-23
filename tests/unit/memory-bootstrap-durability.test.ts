import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    BOOTSTRAP_TRACE_PREFIX,
    COMPACT_MARKER_CONTENT,
    MANAGED_COMPACT_PREFIX,
    isCompactMarkerRow,
    getRowsSinceLatestCompactForTest,
    renderBootstrapPrompt,
    normalizeWorkingDir,
    type BootstrapSlots,
} from '../../src/core/compact.ts';

describe('Phase 52 — Bootstrap Durability', () => {
    test('bootstrap compact row is a valid boundary for getRowsSinceLatestCompact', () => {
        const bootstrapRow = {
            role: 'assistant',
            content: COMPACT_MARKER_CONTENT,
            trace: `${BOOTSTRAP_TRACE_PREFIX}\n<overall_goal>test</overall_goal>`,
        };
        const rows = [
            { role: 'user', content: 'New message after bootstrap' },
            bootstrapRow,
            { role: 'user', content: 'Old message before bootstrap' },
        ];
        const result = getRowsSinceLatestCompactForTest(rows);
        assert.equal(result.length, 1);
        assert.equal(result[0].content, 'New message after bootstrap');
    });

    test('managed compact and bootstrap compact rows both act as boundaries', () => {
        const managedRow = {
            role: 'assistant',
            content: COMPACT_MARKER_CONTENT,
            trace: `${MANAGED_COMPACT_PREFIX}\nkeep facts`,
        };
        const bootstrapRow = {
            role: 'assistant',
            content: COMPACT_MARKER_CONTENT,
            trace: `${BOOTSTRAP_TRACE_PREFIX}\npayload`,
        };
        // Bootstrap is more recent
        const rows = [
            { role: 'user', content: 'newest' },
            bootstrapRow,
            { role: 'user', content: 'between' },
            managedRow,
            { role: 'user', content: 'oldest' },
        ];
        const result = getRowsSinceLatestCompactForTest(rows);
        assert.equal(result.length, 1);
        assert.equal(result[0].content, 'newest');
    });

    test('normalizeWorkingDir handles tilde expansion', () => {
        const home = process.env.HOME || '/Users/test';
        assert.equal(normalizeWorkingDir(`~/projects`), `${home}/projects`);
        assert.equal(normalizeWorkingDir('~'), null);
        assert.equal(normalizeWorkingDir(null), null);
        assert.equal(normalizeWorkingDir(''), null);
    });

    test('renderBootstrapPrompt produces valid handoff structure', () => {
        const slots: BootstrapSlots = {
            goal: 'Fix the auth bug',
            recent_turns: '- [user] Please fix login\n- [assistant] Found the issue in auth.ts',
            memory_hits: 'User prefers minimal logging',
            grep_hits: '- src/auth.ts:42 validateToken',
            task_snapshot: '## Task Snapshot\n### episodes/live/2026-04-23.md:1-4\nAuth fix in progress',
        };
        const result = renderBootstrapPrompt(slots);

        assert.ok(result.startsWith('# Compacted Session Handoff'));
        assert.ok(result.includes('<overall_goal>'));
        assert.ok(result.includes('Fix the auth bug'));
        assert.ok(result.includes('</overall_goal>'));
        assert.ok(result.includes('<recent_actions>'));
        assert.ok(result.includes('</recent_actions>'));
        assert.ok(result.includes('<key_knowledge>'));
        assert.ok(result.includes('</key_knowledge>'));
        assert.ok(result.includes('<artifact_trail>'));
        assert.ok(result.includes('</artifact_trail>'));
        assert.ok(result.includes('<current_state>'));
        assert.ok(result.includes('</current_state>'));
    });

    test('bootstrap trace format matches expected prefix', () => {
        const slots: BootstrapSlots = {
            goal: 'test',
            recent_turns: '',
            memory_hits: '',
            grep_hits: '',
            task_snapshot: '',
        };
        const bootstrap = renderBootstrapPrompt(slots);
        const trace = `${BOOTSTRAP_TRACE_PREFIX}\n${bootstrap}`;
        assert.ok(trace.startsWith(BOOTSTRAP_TRACE_PREFIX));
        assert.ok(trace.includes('Compacted Session Handoff'));
    });

    test('bootstrap row with correct trace is detected as compact marker', () => {
        const slots: BootstrapSlots = {
            goal: 'durability test',
            recent_turns: '- [user] hello',
            memory_hits: '',
            grep_hits: '',
            task_snapshot: '',
        };
        const bootstrap = renderBootstrapPrompt(slots);
        const row = {
            role: 'assistant',
            content: COMPACT_MARKER_CONTENT,
            trace: `${BOOTSTRAP_TRACE_PREFIX}\n${bootstrap}`,
        };
        assert.ok(isCompactMarkerRow(row));
    });
});

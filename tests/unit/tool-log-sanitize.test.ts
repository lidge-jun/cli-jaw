import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_TOOL_LOG_ENTRIES,
    MAX_TOOL_LOG_JSON_CHARS,
    MAX_TOOL_LOG_RAW_INPUT_CHARS,
    MAX_TOOL_LOG_STRING_CHARS,
    parseToolLogBounded,
    sanitizeToolLogForDurableStorage,
    serializeSanitizedToolLog,
} from '../../src/shared/tool-log-sanitize.ts';
import { addBroadcastListener, broadcast, clearAllBroadcastListeners } from '../../src/core/bus.ts';
import { beginLiveRun, getLiveRun, replaceLiveRunTools, clearLiveRun } from '../../src/agent/live-run-state.ts';

test.afterEach(() => {
    clearAllBroadcastListeners();
    clearLiveRun('unit');
});

test('tool log sanitizer hard-caps fields, entry count, and serialized JSON', () => {
    const huge = 'x'.repeat(200_000);
    const entries = Array.from({ length: MAX_TOOL_LOG_ENTRIES + 20 }, (_v, index) => ({
        icon: huge,
        rawIcon: huge,
        label: `tool-${index}-${huge}`,
        detail: huge,
        toolType: `type-${huge}`,
        stepRef: `ref-${index}-${huge}`,
        status: `running-${huge}`,
    }));

    const sanitized = sanitizeToolLogForDurableStorage(entries);
    const serialized = serializeSanitizedToolLog(entries);

    assert.ok(sanitized.length <= MAX_TOOL_LOG_ENTRIES);
    assert.ok(serialized);
    assert.ok(serialized!.length <= MAX_TOOL_LOG_JSON_CHARS);
    for (const entry of sanitized) {
        assert.ok(entry.icon.length <= MAX_TOOL_LOG_STRING_CHARS);
        assert.ok(entry.label.length <= MAX_TOOL_LOG_STRING_CHARS);
        assert.ok((entry.rawIcon || '').length <= MAX_TOOL_LOG_STRING_CHARS);
        assert.ok((entry.toolType || '').length <= MAX_TOOL_LOG_STRING_CHARS);
        assert.ok((entry.stepRef || '').length <= MAX_TOOL_LOG_STRING_CHARS);
        assert.ok((entry.status || '').length <= MAX_TOOL_LOG_STRING_CHARS);
    }
    assert.ok(!serialized!.includes(huge.slice(0, 1000)));
});

test('bounded parse refuses oversized legacy raw JSON strings before JSON.parse', () => {
    const oversized = `[${' '.repeat(MAX_TOOL_LOG_RAW_INPUT_CHARS + 1)}]`;
    const parsed = parseToolLogBounded(oversized);

    assert.equal(parsed.length, 1);
    assert.match(parsed[0]!.label, /truncated|omitted/i);
});

test('broadcast and live-run state bound live tool payloads before JSON serialization', () => {
    const huge = 'z'.repeat(120_000);
    let seen: Record<string, any> | null = null;
    addBroadcastListener((_type, data) => {
        seen = data;
    });

    broadcast('agent_tool', {
        agentId: 'unit',
        icon: huge,
        label: huge,
        detail: huge,
        toolType: huge,
        stepRef: huge,
        status: huge,
    });

    assert.ok(seen);
    assert.ok(String(seen!.detail || '').length < huge.length);
    assert.ok(String(seen!.label || '').length <= MAX_TOOL_LOG_STRING_CHARS);

    beginLiveRun('unit', 'codex');
    const rawLog = [{ icon: '🔧', label: huge, detail: huge, toolType: 'tool', status: 'running' }];
    replaceLiveRunTools('unit', rawLog);
    const live = getLiveRun('unit');

    assert.ok(String(live.toolLog[0]!.detail || '').length < huge.length);
    assert.ok(String(live.toolLog[0]!.label || '').length <= MAX_TOOL_LOG_STRING_CHARS);
    assert.ok(String(rawLog[0]!.detail || '').length < huge.length);
});

test('tool log sanitizer preserves trace pointers without preserving raw detail', () => {
    const rawDetail = 'raw-line\n'.repeat(10_000);
    const runId = 'tr_1234567890abcdef1234567890abcdef';
    const serialized = serializeSanitizedToolLog([{
        icon: '🔧',
        label: 'exec',
        detail: rawDetail,
        toolType: 'tool',
        stepRef: 'step-1',
        traceRunId: runId,
        traceSeq: 42,
        detailAvailable: true,
        detailBytes: 123456,
        rawRetentionStatus: 'spilled',
        isEmployee: true,
    }]);

    assert.ok(serialized);
    assert.ok(serialized!.length <= MAX_TOOL_LOG_JSON_CHARS);
    const parsed = parseToolLogBounded(serialized);
    assert.equal(parsed[0]!.traceRunId, runId);
    assert.equal(parsed[0]!.traceSeq, 42);
    assert.equal(parsed[0]!.detailAvailable, true);
    assert.equal(parsed[0]!.detailBytes, 123456);
    assert.equal(parsed[0]!.rawRetentionStatus, 'spilled');
    assert.equal(parsed[0]!.isEmployee, true);
    assert.ok(!serialized!.includes(rawDetail.slice(0, 5000)));
});

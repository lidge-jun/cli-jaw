import test from 'node:test';
import assert from 'node:assert/strict';
import {
    appendTraceEvent,
    finalizeTraceRun,
    getTraceEvent,
    getTraceRun,
    listTraceEvents,
    stampTraceTool,
    startTraceRun,
} from '../../src/trace/store.ts';
import type { ToolEntry } from '../../src/types/agent.ts';

test('trace store records redacted raw events, spills large payloads, and stamps tool pointers', () => {
    const runId = startTraceRun({
        cli: 'codex',
        model: 'gpt-test',
        workingDir: '/tmp/project',
        agentLabel: 'main',
        audience: 'public',
    });

    const first = appendTraceEvent({
        runId,
        source: 'cli_raw',
        eventType: 'item.started',
        raw: { type: 'item.started', headers: { authorization: 'Bearer secret-token-1234567890' } },
    });
    const large = appendTraceEvent({
        runId,
        source: 'cli_raw',
        eventType: 'large',
        raw: { text: 'x'.repeat(140_000) },
    });
    const tool: ToolEntry = { icon: '🔧', label: 'exec', toolType: 'tool', detail: 'full detail' };
    stampTraceTool(tool, { traceRunId: runId, traceAudience: 'public' }, 'tool');
    finalizeTraceRun(runId, 'done');

    assert.equal(first?.traceRunId, runId);
    assert.equal(large?.rawRetentionStatus, 'spilled');
    assert.equal(tool.traceRunId, runId);
    assert.equal(tool.detailAvailable, true);

    const page = listTraceEvents(runId, 0, 10);
    assert.equal(page.total, 3);
    const raw = getTraceEvent(runId, 1);
    assert.ok(raw?.raw.includes('[REDACTED]'));
    assert.ok(!raw?.raw.includes('secret-token-1234567890'));
    const run = getTraceRun(runId);
    assert.equal(run?.status, 'done');
    assert.equal(run?.event_count, 3);
});

test('internal trace tool pointers are stored but not marked as detail-available', () => {
    const runId = startTraceRun({ cli: 'copilot', audience: 'internal' });
    const tool: ToolEntry = { icon: '💭', label: 'internal thought', toolType: 'thinking', detail: 'hidden' };
    stampTraceTool(tool, { traceRunId: runId, traceAudience: 'internal' }, 'thinking');

    assert.equal(tool.traceRunId, runId);
    assert.equal(tool.detailAvailable, false);
    assert.equal(tool.rawRetentionStatus, 'internal');
});

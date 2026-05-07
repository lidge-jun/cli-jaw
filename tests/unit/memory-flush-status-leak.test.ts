import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flushClaudeBuffers } from '../../src/agent/events.ts';
import { activeProcesses, isAgentBusy } from '../../src/agent/spawn.ts';
import { clearAllBroadcastListeners, setWss } from '../../src/core/bus.ts';
import type { SpawnContext } from '../../src/types/agent.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (path: string): string => readFileSync(join(__dirname, '../..', path), 'utf8');

const spawnSrc = src('src/agent/spawn.ts');
const lifecycleSrc = src('src/agent/lifecycle-handler.ts');
const flushSrc = src('src/agent/memory-flush-controller.ts');
const eventsSrc = src('src/agent/events.ts');
const persistenceSrc = src('src/agent/session-persistence.ts');

test('memory-flush spawn is not main-managed and uses isolated history/session policy', () => {
    assert.ok(
        spawnSrc.includes('const mainManaged = !forceNew && !empSid && !opts.internal'),
        'internal memory-flush must not own activeProcess/isAgentBusy main state',
    );
    assert.ok(flushSrc.includes('forceNew: true'), 'memory flush must not resume main provider session');
    assert.ok(flushSrc.includes('_skipHistory: true'), 'memory flush must not receive full history twice');
    assert.ok(
        spawnSrc.includes('!isResume && !opts._skipHistory ? buildHistoryBlock'),
        'standard history injection must honor _skipHistory',
    );
    assert.ok(
        spawnSrc.includes('needsHistoryFallback && !opts._skipHistory ? buildHistoryBlock'),
        'ACP fallback history must honor _skipHistory',
    );
    assert.ok(
        persistenceSrc.includes('input.forceNew || input.employeeSessionId'),
        'forceNew sidecars must not persist as main provider sessions',
    );
});

test('internal memory-flush does not rely on timer queue drain', () => {
    assert.ok(!flushSrc.includes("await import('./spawn.js')"), 'flush controller must not import processQueue');
    assert.ok(!flushSrc.includes('setTimeout(async () =>'), 'flush controller must not timer-drain the queue');
});

test('internal status and tool broadcasts are guarded from public WebSocket clients', () => {
    assert.ok(
        spawnSrc.includes("if (!opts.internal) broadcast('agent_status', { status: 'running'"),
        'second-phase running status must be suppressed for internal runs',
    );
    assert.ok(
        lifecycleSrc.includes('if (!opts.internal)') && lifecycleSrc.includes("broadcast('agent_status'"),
        'final done/error status must be suppressed for internal runs',
    );
    assert.ok(
        spawnSrc.includes("broadcast('agent_tool', { agentId: agentLabel, ...tool, ...empTag }, traceAudience)"),
        'ACP tool broadcasts must use traceAudience',
    );
    assert.ok(
        eventsSrc.includes('function emitAgentTool(')
            && eventsSrc.includes("ctx.traceAudience === 'internal' ? 'internal' : 'public'"),
        'standard CLI events must route agent_tool through ctx.traceAudience',
    );
    assert.equal(
        (eventsSrc.match(/broadcast\('agent_tool'/g) || []).length,
        0,
        'events.ts must not contain direct public-default agent_tool broadcasts',
    );
});

test('internal sidecars do not inherit parent live-run tool ownership', () => {
    assert.ok(
        spawnSrc.includes("const parentLiveScopeForChild = !opts.internal && isEmployee ? liveScope : null"),
        'internal sidecars must not append tools into a public parent live run',
    );
    assert.equal(
        (spawnSrc.match(/parentLiveScope: isEmployee \? liveScope : null/g) || []).length,
        0,
        'legacy parentLiveScope employee inference must be removed',
    );
});

test('flushClaudeBuffers emits internal tool events without sending public WebSocket messages', () => {
    const sent: string[] = [];
    setWss({
        clients: [
            { readyState: 1, send: (msg: string): void => { sent.push(msg); } },
        ],
    } as any);
    clearAllBroadcastListeners();
    const ctx: SpawnContext = {
        fullText: '',
        traceLog: [],
        toolLog: [],
        seenToolKeys: new Set<string>(),
        hasClaudeStreamEvents: false,
        sessionId: null,
        cost: null,
        turns: null,
        duration: null,
        tokens: null,
        stderrBuf: '',
        traceAudience: 'internal',
        claudeThinkingBuf: 'background memory flush thought',
    };

    flushClaudeBuffers(ctx, 'memory-flush', { isEmployee: true });

    assert.equal(ctx.toolLog.length, 1, 'internal flush thinking still records toolLog internally');
    assert.equal(sent.length, 0, 'internal flush tool event must not reach public WebSocket clients');
    setWss(null);
    clearAllBroadcastListeners();
});

test('memory-flush can be active by id without making isAgentBusy true', () => {
    const fakeChild = { pid: 999999 } as any;
    activeProcesses.set('memory-flush', fakeChild);
    try {
        assert.equal(isAgentBusy(), false, 'active memory-flush sidecar must not block user messages');
    } finally {
        activeProcesses.delete('memory-flush');
    }
});

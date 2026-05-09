import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFromEvent } from '../../src/agent/events.ts';
import { detectLongRunningToolTimeout } from '../../src/agent/tool-timeout.ts';
import type { SpawnContext } from '../../src/types/agent.ts';

test('detects agbrowse web-ai query timeout in seconds', () => {
    const detected = detectLongRunningToolTimeout('agbrowse web-ai query --vendor chatgpt --timeout 1800 --json');
    assert.ok(detected);
    assert.equal(detected.timeoutMs, 1_800_000);
    assert.match(detected.commandKind, /agbrowse web-ai query/i);
});

test('detects agbrowse web-ai poll timeout with equals syntax', () => {
    const detected = detectLongRunningToolTimeout('agbrowse web-ai poll --vendor chatgpt --timeout=1200 --json');
    assert.ok(detected);
    assert.equal(detected.timeoutMs, 1_200_000);
});

test('detects cli-jaw browser web-ai timeout in minutes', () => {
    const detected = detectLongRunningToolTimeout('cli-jaw browser web-ai query --vendor chatgpt --timeout 30m');
    assert.ok(detected);
    assert.equal(detected.timeoutMs, 1_800_000);
});

test('detects jaw browser web-ai timeout in milliseconds', () => {
    const detected = detectLongRunningToolTimeout('jaw browser web-ai poll --vendor chatgpt --timeout 500ms');
    assert.ok(detected);
    assert.equal(detected.timeoutMs, 500);
});

test('detects web-ai command inside shell wrapper', () => {
    const detected = detectLongRunningToolTimeout('/bin/zsh -lc "agbrowse web-ai query --vendor chatgpt --timeout 1800"');
    assert.ok(detected);
    assert.equal(detected.timeoutMs, 1_800_000);
    assert.equal(detected.commandKind, 'agbrowse web-ai query');
});

test('ignores unrelated timeout flags', () => {
    assert.equal(detectLongRunningToolTimeout('curl --timeout 60 https://example.com'), null);
    assert.equal(detectLongRunningToolTimeout('npm test --timeout 600'), null);
    assert.equal(detectLongRunningToolTimeout('agbrowse web-ai status --timeout 600'), null);
});

test('ignores allowed commands without usable timeout', () => {
    assert.equal(detectLongRunningToolTimeout('agbrowse web-ai query --vendor chatgpt'), null);
    assert.equal(detectLongRunningToolTimeout('agbrowse web-ai poll --timeout 0'), null);
    assert.equal(detectLongRunningToolTimeout('agbrowse web-ai poll --timeout nope'), null);
});

test('Codex command start extends the active watchdog for long-running web-ai command', () => {
    let extension: { extraMs: number; reason?: string } | null = null;
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
        stallWatchdog: {
            markProgress() {},
            extendDeadline(extraMs: number, reason?: string) {
                extension = { extraMs, reason };
            },
            stop() {},
        },
    };

    extractFromEvent('codex', {
        type: 'item.started',
        item: {
            id: 'cmd-1',
            type: 'command_execution',
            command: 'agbrowse web-ai query --vendor chatgpt --model pro --timeout 1800',
        },
    }, ctx, 'main');

    assert.deepEqual(extension, {
        extraMs: 2_400_000,
        reason: 'agbrowse web-ai query',
    });
    assert.ok(ctx.traceLog.some(line => line.includes('[watchdog] extended for agbrowse web-ai query by 2400s')));
});

// ACP diagnostic logging — regression tests
// Validates that unhandled request logging and cancel detection are properly configured

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';

const ACP_PATH = new URL('../../src/cli/acp-client.ts', import.meta.url).pathname;
const SPAWN_PATH = new URL('../../src/agent/spawn.ts', import.meta.url).pathname;
const acpSrc = fs.readFileSync(ACP_PATH, 'utf8');
const spawnSrc = fs.readFileSync(SPAWN_PATH, 'utf8');

// ─── acp-client.ts ───────────────────────────────────

test('unhandled agent requests are always logged (not DEBUG-only)', () => {
    // Should have console.warn for unhandled requests
    assert.match(acpSrc, /console\.warn\(.*acp:unhandled/,
        'unhandled agent requests must be logged with console.warn (always, not DEBUG-gated)');
    // Should NOT have DEBUG-gated logging for unsupported requests
    const defaultBlock = acpSrc.slice(acpSrc.indexOf('default:'));
    assert.ok(!defaultBlock.includes('process.env.DEBUG'),
        'unhandled request logging must not be gated behind DEBUG env variable');
});

test('session/cancelled notifications are logged', () => {
    assert.match(acpSrc, /session\/cancelled/,
        'acp-client must handle session/cancelled notifications');
    assert.match(acpSrc, /console\.warn\(.*acp:cancelled/,
        'session/cancelled must be logged with console.warn');
});

// ─── spawn.ts ────────────────────────────────────────

test('ACP unexpected exit is warned', () => {
    assert.match(spawnSrc, /acp:unexpected-exit/,
        'spawn.ts must log unexpected ACP exits (code≠0 && !killReason)');
});

test('unexpected exit check is before killReason consumption', () => {
    const exitHandler = spawnSrc.slice(spawnSrc.indexOf("acp.on('exit'"));
    const unexpectedIdx = exitHandler.indexOf('acp:unexpected-exit');
    const consumeIdx = exitHandler.indexOf('killReason = null');
    assert.ok(unexpectedIdx < consumeIdx,
        'unexpected exit check must come before killReason is consumed (set to null)');
});

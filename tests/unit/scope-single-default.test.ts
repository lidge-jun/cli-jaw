import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveOrcScope, findActiveScope } from '../../src/orchestrator/scope.ts';
import { getCtx, setState, resetState } from '../../src/orchestrator/state-machine.ts';

test('SSD-001: resolveOrcScope always returns default regardless of input', () => {
    assert.equal(resolveOrcScope(), 'default');
    assert.equal(resolveOrcScope({ origin: 'telegram', chatId: 123 }), 'default');
    assert.equal(resolveOrcScope({ origin: 'discord', workingDir: '/tmp/x' }), 'default');
    assert.equal(resolveOrcScope({ persistedScopeId: 'legacy:old' }), 'default');
});

test('SSD-002: findActiveScope always returns default', () => {
    assert.equal(findActiveScope('web'), 'default');
    assert.equal(findActiveScope('telegram', 123, { workingDir: '/tmp' }), 'default');
    assert.equal(findActiveScope('discord'), 'default');
});

test('SSD-003: normalizeQueueItem hardcodes scope to default', () => {
    const spawnSrc = readFileSync(new URL('../../src/agent/spawn.ts', import.meta.url), 'utf8');
    assert.ok(spawnSrc.includes("scope: 'default',"),
        'normalizeQueueItem must hardcode scope to default');
});

test('SSD-004: ctx.scopeId is persisted in default scope', () => {
    resetState('default');
    setState('P', {
        originalPrompt: 'test',
        workingDir: null,
        scopeId: 'default',
        plan: null,
        workerResults: [],
        origin: 'web',
    }, 'default');

    const ctx = getCtx('default');
    assert.equal(ctx?.scopeId, 'default');
    resetState('default');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    bumpSessionOwnershipGeneration,
    getSessionOwnershipGeneration,
    resetSessionOwnershipGenerationForTest,
    shouldPersistMainSession,
} from '../../src/agent/session-persistence.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('session persistence allows current owner to save successful non-fallback result', () => {
    resetSessionOwnershipGenerationForTest();
    const ownerGeneration = getSessionOwnershipGeneration();
    const ok = shouldPersistMainSession({
        ownerGeneration,
        cli: 'codex',
        model: 'gpt-5-codex',
        effort: 'high',
        sessionId: 'abc',
        code: 0,
    });
    assert.equal(ok, true);
});

test('session persistence blocks fallback runs from saving main session row', () => {
    resetSessionOwnershipGenerationForTest();
    const ownerGeneration = getSessionOwnershipGeneration();
    const ok = shouldPersistMainSession({
        ownerGeneration,
        cli: 'copilot',
        model: 'default',
        effort: '',
        sessionId: 'fallback-session',
        isFallback: true,
        code: 0,
    });
    assert.equal(ok, false);
});

test('session persistence blocks stale owner after generation bump', () => {
    resetSessionOwnershipGenerationForTest();
    const staleOwner = getSessionOwnershipGeneration();
    bumpSessionOwnershipGeneration();
    const ok = shouldPersistMainSession({
        ownerGeneration: staleOwner,
        cli: 'claude',
        model: 'sonnet',
        effort: 'medium',
        sessionId: 'stale-owner',
        code: 0,
    });
    assert.equal(ok, false);
});

test('session persistence blocks non-zero exits', () => {
    resetSessionOwnershipGenerationForTest();
    const ownerGeneration = getSessionOwnershipGeneration();
    const ok = shouldPersistMainSession({
        ownerGeneration,
        cli: 'claude',
        model: 'sonnet',
        effort: 'medium',
        sessionId: 'failed',
        code: 1,
    });
    assert.equal(ok, false);
});

test('agent system uses shared persistence and resume-classifier helpers', () => {
    const spawnSrc = fs.readFileSync(join(__dirname, '../../src/agent/spawn.ts'), 'utf8');
    const lifecycleSrc = fs.readFileSync(join(__dirname, '../../src/agent/lifecycle-handler.ts'), 'utf8');
    // persistMainSession is called in spawn.ts (ACP pre-shutdown) and lifecycle-handler.ts (exit handler)
    assert.ok(spawnSrc.includes('persistMainSession(') || lifecycleSrc.includes('persistMainSession('),
        'system should use shared persistence helper');
    // shouldInvalidateResumeSession is called in lifecycle-handler.ts (unified exit handler)
    assert.ok(lifecycleSrc.includes('shouldInvalidateResumeSession('),
        'lifecycle handler should use shared resume classifier');
});

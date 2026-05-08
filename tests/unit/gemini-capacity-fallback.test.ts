import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { classifyExitError } from '../../src/agent/error-classifier.ts';
import { shouldPersistMainSession } from '../../src/agent/session-persistence.ts';
import { addBroadcastListener, clearAllBroadcastListeners } from '../../src/core/bus.ts';
import { recordError } from '../../src/agent/alert-escalation.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readSrc(rel: string): string {
    return fs.readFileSync(join(__dirname, rel), 'utf8');
}

test('Gemini capacity classifier separates MODEL_CAPACITY_EXHAUSTED from auth/quota', () => {
    const result = classifyExitError(
        'gemini',
        1,
        'Attempt 1 failed with status 429',
        undefined,
        'MODEL_CAPACITY_EXHAUSTED: No capacity available for model gemini-3.1-pro-preview',
    );

    assert.equal(result.is429, true);
    assert.equal(result.isModelCapacity, true);
    assert.equal(result.isAuth, false);
    assert.match(result.message, /capacity/);
});

test('session persistence can be skipped for transient Gemini Auto fallback', () => {
    assert.equal(shouldPersistMainSession({
        ownerGeneration: 0,
        sessionId: 'transient-auto-session',
        skipSessionPersist: true,
        cli: 'gemini',
        model: 'default',
        effort: '',
    }), false);
});

test('Gemini capacity fallback branch precedes generic same-model 429 retry', () => {
    const src = readSrc('../../src/agent/lifecycle-handler.ts');
    const capacityIdx = src.indexOf('Gemini model capacity: one-request Auto fallback');
    const retryIdx = src.indexOf('429 delay retry');

    assert.ok(capacityIdx > 0, 'capacity fallback branch must exist');
    assert.ok(retryIdx > 0, 'generic 429 retry branch must exist');
    assert.ok(capacityIdx < retryIdx, 'capacity fallback must run before same-model 429 retry');
});

test('Gemini capacity fallback keeps main ownership and skips only resume/session persistence', () => {
    const lifecycle = readSrc('../../src/agent/lifecycle-handler.ts');
    const branch = lifecycle.slice(
        lifecycle.indexOf('Gemini model capacity: one-request Auto fallback'),
        lifecycle.indexOf('429 delay retry'),
    );

    assert.match(branch, /model:\s*'default'/);
    assert.match(branch, /_skipResume:\s*true/);
    assert.match(branch, /_skipSessionPersist:\s*true/);
    assert.match(branch, /_isCapacityFallback:\s*true/);
    assert.doesNotMatch(branch, /forceNew:\s*true/);
});

test('Gemini resumed capacity fallback clears stale bucket before retrying without resume', () => {
    const lifecycle = readSrc('../../src/agent/lifecycle-handler.ts');
    const branch = lifecycle.slice(
        lifecycle.indexOf('Gemini resumed capacity failure'),
        lifecycle.indexOf('Gemini model capacity: one-request Auto fallback'),
    );

    assert.match(branch, /isResume/);
    assert.match(branch, /const\s+bucket\s*=\s*resolveSessionBucket\(cli,\s*model\)/);
    assert.match(branch, /clearSessionBucket\.run\(bucket\)/);
    assert.match(branch, /_skipResume:\s*true/);
    assert.match(branch, /_skipSessionPersist:\s*true/);
    assert.match(branch, /_isCapacityFallback:\s*true/);
});

test('Gemini high-turn compact coordination clears session bucket like Codex/OpenCode', () => {
    const lifecycle = readSrc('../../src/agent/lifecycle-handler.ts');
    assert.match(lifecycle, /cli\s*===\s*'codex'\s*\|\|\s*cli\s*===\s*'opencode'\s*\|\|\s*cli\s*===\s*'gemini'/);
});

test('Gemini capacity fallback disables resume without changing mainManaged predicate', () => {
    const spawn = readSrc('../../src/agent/spawn.ts');

    assert.match(spawn, /const\s+mainManaged\s*=\s*!forceNew\s*&&\s*!empSid\s*&&\s*!opts\.internal/);
    assert.match(spawn, /!\s*opts\._skipResume\s*&&\s*!forceNew\s*&&\s*!!bucketSessionId/);
});

test('model capacity alert does not tell the user to re-login', () => {
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    clearAllBroadcastListeners();
    addBroadcastListener((type, data) => events.push({ type, data }));

    const cli = `gemini-capacity-test-${Date.now()}`;
    recordError(cli, 'model_capacity');
    recordError(cli, 'model_capacity');
    recordError(cli, 'model_capacity');

    const alert = events.find(event => event.type === 'alert_escalation');
    assert.ok(alert, 'capacity error threshold should emit alert');
    const message = String(alert.data['message'] ?? '');
    assert.match(message, /capacity|Auto\/Flash/);
    assert.doesNotMatch(message, /로그인 상태 확인 필요/);

    clearAllBroadcastListeners();
});

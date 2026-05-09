import test from 'node:test';
import assert from 'node:assert/strict';
import {
    captureWebAiDiagnostics,
    redactDiagnosticText,
    normalizeFailureStage,
    emptyDiagnostics,
    toWebAiErrorEnvelope,
} from '../../src/browser/web-ai/diagnostics.js';

test('DIAG-001: redactDiagnosticText scrubs bearer tokens and emails', () => {
    const out = redactDiagnosticText('Authorization: Bearer abc123xyz user@example.com');
    assert.doesNotMatch(out, /abc123xyz/);
    assert.doesNotMatch(out, /user@example\.com/);
});

test('DIAG-002: normalizeFailureStage clamps unknown values to "unknown"', () => {
    assert.equal(normalizeFailureStage('garbage' as any), 'unknown');
    assert.equal(normalizeFailureStage('send-click'), 'send-click');
    assert.equal(normalizeFailureStage('poll-timeout'), 'poll-timeout');
    assert.equal(normalizeFailureStage('capability-preflight'), 'capability-preflight');
    assert.equal(normalizeFailureStage('provider-select-model'), 'provider-select-model');
    assert.equal(normalizeFailureStage('provider-interstitial'), 'provider-interstitial');
});

test('DIAG-003: emptyDiagnostics has all required fields', () => {
    const d = emptyDiagnostics('send-click');
    assert.equal(d.stage, 'send-click');
    assert.ok(Array.isArray(d.usedFallbacks));
    assert.ok(Array.isArray(d.warnings));
});

test('DIAG-004: toWebAiErrorEnvelope returns ok:false envelope with stage', () => {
    const env = toWebAiErrorEnvelope(new Error('boom'), 'send-click');
    assert.equal(env.ok, false);
    assert.equal(env.stage, 'send-click');
    assert.match(env.error, /boom/);
});

test('DIAG-005: toWebAiErrorEnvelope preserves stage from error.stage when present', () => {
    const e: any = new Error('x');
    e.stage = 'poll-timeout';
    const env = toWebAiErrorEnvelope(e, 'unknown');
    assert.equal(env.stage, 'poll-timeout');
});

test('DIAG-006: web-ai diagnostics use browser-core diagnostic capture for counts', async () => {
    const d = await captureWebAiDiagnostics({
        stage: 'status',
        page: fakeDiagnosticsPage(),
    });
    assert.equal(d.selectorCounts['#prompt-textarea'], 1);
    assert.equal(d.visibleComposerCandidates, 1);
    assert.equal(d.assistantTurnCount, 2);
    assert.equal(d.title, 'ChatGPT [email redacted]');
});

function fakeDiagnosticsPage(): any {
    return {
        url: async () => 'https://chatgpt.com/c/test',
        title: async () => 'ChatGPT user@example.com',
        locator: (selector: string) => ({
            count: async () => {
                if (selector === '#prompt-textarea') return 1;
                if (selector.includes('data-message-author-role')) return 2;
                return 0;
            },
            all: async () => selector === '#prompt-textarea'
                ? [{ waitFor: async () => undefined, boundingBox: async () => ({ width: 10, height: 10 }) }]
                : [],
            first: () => ({
                isVisible: async () => false,
                isDisabled: async () => false,
            }),
        }),
    };
}

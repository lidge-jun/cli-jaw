import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createDisabledProviderAdapter,
    ProviderRuntimeDisabledError,
} from '../../src/browser/web-ai/provider-adapter.js';
import {
    createGeminiDeepThinkContractAdapter,
    reportGeminiContractOnlyStatus,
    GEMINI_DEEP_THINK_SELECTORS,
    GEMINI_DEEP_THINK_CONSTRAINTS,
    GEMINI_DEEP_THINK_OFFICIAL_SOURCES,
} from '../../src/browser/web-ai/gemini-contract.js';

test('PRV-001: disabled adapter rejects every mutation with ProviderRuntimeDisabledError', async () => {
    const a = createDisabledProviderAdapter('gemini');
    assert.equal(a.mutationAllowed, false);
    await assert.rejects(() => a.waitForUi(), ProviderRuntimeDisabledError);
    await assert.rejects(() => a.typePrompt('x'), ProviderRuntimeDisabledError);
    await assert.rejects(() => a.submitPrompt(), ProviderRuntimeDisabledError);
    await assert.rejects(() => a.waitForResponse({ minTurnIndex: 0, timeoutMs: 1 } as any), ProviderRuntimeDisabledError);
});

test('PRV-002: ProviderRuntimeDisabledError carries vendor and stage', () => {
    const e = new ProviderRuntimeDisabledError('gemini', 'send-click');
    assert.equal(e.vendor, 'gemini');
    assert.equal(e.stage, 'send-click');
});

test('PRV-003: gemini contract adapter is disabled and has selectors snapshot', async () => {
    const a = createGeminiDeepThinkContractAdapter();
    assert.equal(a.mutationAllowed, false);
    await assert.rejects(() => a.submitPrompt(), ProviderRuntimeDisabledError);
    assert.ok(GEMINI_DEEP_THINK_SELECTORS.input.length > 0);
    assert.ok(GEMINI_DEEP_THINK_CONSTRAINTS.minimumWaitMs >= 90_000);
    assert.ok(GEMINI_DEEP_THINK_OFFICIAL_SOURCES.length >= 1);
});

test('PRV-004: reportGeminiContractOnlyStatus flags runtime as disabled and cites docs', () => {
    const r = reportGeminiContractOnlyStatus();
    assert.equal(r.runtimeEnabled, false);
    assert.ok(r.sources.length >= 1);
    assert.ok(r.notes.some(n => /contract|disabled|deep think/i.test(n)));
});

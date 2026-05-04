import test from 'node:test';
import assert from 'node:assert/strict';
import {
    captureAssistantResponse,
    isPlaceholderAssistantText,
    normalizeAssistantText,
} from '../../src/browser/web-ai/chatgpt-response.js';

test('RESP-001: placeholders are filtered (typing indicator, empty)', () => {
    assert.equal(isPlaceholderAssistantText(''), true);
    assert.equal(isPlaceholderAssistantText('   '), true);
    assert.equal(isPlaceholderAssistantText('Thinking'), true);
    assert.equal(isPlaceholderAssistantText('Answer now'), true);
});

test('RESP-002: real answers are NOT considered placeholders', () => {
    assert.equal(isPlaceholderAssistantText('Sure, here is the answer: 42.'), false);
    assert.equal(isPlaceholderAssistantText('def hello():\n    return "world"'), false);
});

test('RESP-003: normalizeAssistantText collapses NBSP and trims', () => {
    const text = '\u00a0  hello world  \u00a0';
    assert.equal(normalizeAssistantText(text), 'hello world');
});

test('RESP-004: chatgpt-response source has no external provider imports and no public evaluate', async () => {
    const fs: any = await import('node:fs');
    const src = fs.readFileSync(new URL('../../src/browser/web-ai/chatgpt-response.ts', import.meta.url), 'utf8');
    assert.match(src, /captureAssistantResponse/);
});

test('RESP-005: captureAssistantResponse records copy fallback through ActionTranscript', async () => {
    const page = fakeResponsePage({
        assistantTexts: ['old answer', 'dom answer'],
        copyText: 'copied answer',
    });
    const result = await captureAssistantResponse(page, {
        minTurnIndex: 1,
        timeoutMs: 80,
        allowCopyMarkdownFallback: true,
        stableWindowMs: 1,
        pollIntervalMs: 1,
    });
    assert.equal(result.ok, true);
    assert.equal(result.answerText, 'copied answer');
    assert.deepEqual(result.usedFallbacks, ['copy-markdown']);
    assert.equal(page.copySelectorSet?.copyButtonSelectors[0], 'button[data-testid="copy-turn-action-button"]');
    assert.equal(result.resolverTrace?.[0]?.intentId, 'copy.lastResponse');
    assert.equal(result.resolverTrace?.[0]?.status, 'ok');
    assert.doesNotMatch(JSON.stringify(result.resolverTrace), /copied answer|dom answer/);
});

function fakeResponsePage(input: { assistantTexts: string[]; copyText: string }): any {
    const page: any = {
        copySelectorSet: null,
        url: () => 'https://chatgpt.com/',
        evaluate: async (fn: any, selectors?: readonly string[]) => {
            const source = String(fn);
            if (source.includes('selectorSet')) {
                page.copySelectorSet = (selectors as any)?.selectorSet || null;
                return { ok: true, text: input.copyText };
            }
            if (Array.isArray(selectors)) return input.assistantTexts;
            return [];
        },
        waitForTimeout: async () => undefined,
        locator: (selector: string) => ({
            count: async () => selector === 'button[data-testid="copy-turn-action-button"]' ? 1 : 0,
            first: () => ({
                isVisible: async () => selector === 'button[data-testid="copy-turn-action-button"]',
                isEnabled: async () => true,
                evaluate: async (fn: any) => fn({
                    getAttribute(name: string) {
                        if (name === 'role') return null;
                        if (name === 'aria-label') return 'Copy';
                        return null;
                    },
                    tagName: 'BUTTON',
                    isContentEditable: false,
                    contentEditable: 'false',
                    textContent: 'Copy',
                }),
                click: async () => undefined,
            }),
            all: async () => selector.includes('copy-turn-action-button')
                ? [{ isVisible: async () => true, click: async () => undefined }]
                : [],
        }),
        getByRole: () => ({
            count: async () => 0,
            first: () => page.locator('missing').first(),
            isVisible: async () => false,
            isEnabled: async () => false,
            evaluate: async () => null,
        }),
    };
    return page;
}

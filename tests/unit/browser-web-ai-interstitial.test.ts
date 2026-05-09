import test from 'node:test';
import assert from 'node:assert/strict';
import { detectInterstitial, isPageDeathError } from '../../src/browser/web-ai/interstitial.js';

function fakePage(options: { bodyText?: string; url?: string; selectors?: Record<string, number> }): any {
    return {
        url: () => options.url || 'https://chatgpt.com/',
        innerText: async () => options.bodyText || '',
        locator: (sel: string) => ({
            count: async () => (options.selectors || {})[sel] || 0,
        }),
    };
}

test('INTST-001: "Just a moment" text classified as cloudflare-challenge', async () => {
    const page = fakePage({ bodyText: 'Just a moment...\nEnable JavaScript and cookies to continue' });
    const result = await detectInterstitial(page);
    assert.equal(result.kind, 'cloudflare-challenge');
    assert.equal(result.retryHint, 'wait-and-retry');
});

test('INTST-002: "Checking if the site connection is secure" classified as cloudflare-challenge', async () => {
    const page = fakePage({ bodyText: 'Checking if the site connection is secure chatgpt.com' });
    const result = await detectInterstitial(page);
    assert.equal(result.kind, 'cloudflare-challenge');
});

test('INTST-003: auth URL classified as login-required', async () => {
    const page = fakePage({ url: 'https://auth0.openai.com/authorize?redirect=...', bodyText: 'OpenAI' });
    const result = await detectInterstitial(page);
    assert.equal(result.kind, 'login-required');
    assert.equal(result.retryHint, 'login');
});

test('INTST-004: short login page classified as login-required', async () => {
    const page = fakePage({ bodyText: 'Welcome back\nLog in to continue' });
    const result = await detectInterstitial(page);
    assert.equal(result.kind, 'login-required');
});

test('INTST-005: ChatGPT empty shell (no composer, no turns) classified as empty-shell', async () => {
    const page = fakePage({ bodyText: 'ChatGPT', url: 'https://chatgpt.com/' });
    const result = await detectInterstitial(page);
    assert.equal(result.kind, 'empty-shell');
    assert.equal(result.retryHint, 'wait-and-retry');
});

test('INTST-006: normal page with composer classified as none', async () => {
    const page = fakePage({
        bodyText: 'ChatGPT conversation content here with lots of text',
        url: 'https://chatgpt.com/c/abc-123',
        selectors: { '#prompt-textarea': 1 },
    });
    const result = await detectInterstitial(page);
    assert.equal(result.kind, 'none');
    assert.equal(result.retryHint, 'none');
});

test('INTST-007: normal page with assistant turns classified as none', async () => {
    const page = fakePage({
        bodyText: 'A long conversation with lots of content',
        url: 'https://chatgpt.com/c/abc-123',
        selectors: { '[data-message-author-role="assistant"]': 2 },
    });
    const result = await detectInterstitial(page);
    assert.equal(result.kind, 'none');
});

test('INTST-008: isPageDeathError detects target closed', () => {
    assert.equal(isPageDeathError(new Error('Target closed')), true);
    assert.equal(isPageDeathError(new Error('Page closed')), true);
    assert.equal(isPageDeathError(new Error('browser has been closed')), true);
    assert.equal(isPageDeathError(new Error('crash detected')), true);
    assert.equal(isPageDeathError(new Error('timeout exceeded')), false);
    assert.equal(isPageDeathError(new Error('selector not found')), false);
});

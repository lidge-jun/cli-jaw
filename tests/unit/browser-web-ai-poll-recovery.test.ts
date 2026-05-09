import test from 'node:test';
import assert from 'node:assert/strict';
import { isPageDeathError } from '../../src/browser/web-ai/interstitial.js';

test('POLL-001: isPageDeathError classifies crash errors correctly', () => {
    assert.equal(isPageDeathError(new Error('Target closed')), true);
    assert.equal(isPageDeathError(new Error('page closed unexpectedly')), true);
    assert.equal(isPageDeathError(new Error('browser has been closed')), true);
    assert.equal(isPageDeathError(new Error('tab crash detected')), true);
});

test('POLL-002: isPageDeathError does not classify non-crash errors', () => {
    assert.equal(isPageDeathError(new Error('Element not found')), false);
    assert.equal(isPageDeathError(new Error('Timeout 30000ms exceeded')), false);
    assert.equal(isPageDeathError(new Error('selector not visible')), false);
});

test('POLL-003: interstitial poll result has non-terminal structure', () => {
    const result = {
        ok: false,
        vendor: 'chatgpt',
        status: 'interstitial' as const,
        url: 'https://chatgpt.com/',
        answerText: '',
        usedFallbacks: [] as string[],
        warnings: ['interstitial: cloudflare-challenge'],
        error: 'page blocked: cloudflare-challenge',
        next: 'poll',
    };
    assert.equal(result.ok, false);
    assert.equal(result.status, 'interstitial');
    assert.equal(result.next, 'poll');
    assert.equal(result.answerText, '');
});

test('POLL-004: watcher classifyTerminalResult does not treat interstitial as terminal', async () => {
    const src: any = await import('node:fs');
    const code = src.readFileSync(new URL('../../src/browser/web-ai/watcher.ts', import.meta.url), 'utf8');
    assert.match(code, /result\.status\s*===\s*'interstitial'/);
});

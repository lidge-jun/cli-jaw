import type { Page } from 'playwright-core';

export type InterstitialKind =
    | 'cloudflare-challenge'
    | 'login-required'
    | 'empty-shell'
    | 'loading'
    | 'none';

export interface InterstitialResult {
    kind: InterstitialKind;
    evidence: string;
    url: string;
    retryHint: 'wait-and-retry' | 'login' | 'navigate' | 'none';
}

const CLOUDFLARE_PATTERNS = [
    'just a moment',
    'checking if the site connection is secure',
    'enable javascript and cookies',
    'ray id',
];

const LOGIN_PATTERNS = [
    'log in',
    'sign in',
    'sign up',
    'create an account',
    'welcome back',
];

const COMPOSER_SELECTORS = [
    '#prompt-textarea',
    '[data-testid="composer-textarea"]',
    'div[contenteditable="true"]',
];

const ASSISTANT_TURN_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '[data-turn="assistant"]',
    'article[data-testid^="conversation-turn"]',
];

export async function detectInterstitial(page: Page): Promise<InterstitialResult> {
    const url = page.url?.() || '';
    try {
        const bodyText: string = await page.innerText('body').catch(() => '');
        const lower = bodyText.toLowerCase();

        if (CLOUDFLARE_PATTERNS.some(p => lower.includes(p))) {
            const matched = CLOUDFLARE_PATTERNS.find(p => lower.includes(p)) || 'cloudflare';
            return { kind: 'cloudflare-challenge', evidence: matched, url, retryHint: 'wait-and-retry' };
        }

        if (/^https:\/\/auth0?\.|\/auth\/|\/login/i.test(url)) {
            return { kind: 'login-required', evidence: `auth URL: ${url}`, url, retryHint: 'login' };
        }
        if (LOGIN_PATTERNS.some(p => lower.includes(p)) && bodyText.length < 2000) {
            const matched = LOGIN_PATTERNS.find(p => lower.includes(p)) || 'login';
            return { kind: 'login-required', evidence: matched, url, retryHint: 'login' };
        }

        const hasComposer = await hasAnySelector(page, COMPOSER_SELECTORS);
        const hasTurns = await hasAnySelector(page, ASSISTANT_TURN_SELECTORS);
        const isChatGptUrl = /chatgpt\.com|chat\.openai\.com/.test(url);
        if (isChatGptUrl && !hasComposer && !hasTurns && bodyText.length < 500) {
            return { kind: 'empty-shell', evidence: 'no composer and no turns', url, retryHint: 'wait-and-retry' };
        }

        return { kind: 'none', evidence: '', url, retryHint: 'none' };
    } catch {
        return { kind: 'none', evidence: 'detection failed', url, retryHint: 'none' };
    }
}

export function isPageDeathError(err: unknown): boolean {
    const msg = String((err as { message?: string })?.message || err || '').toLowerCase();
    return msg.includes('target closed') || msg.includes('page closed') || msg.includes('browser has been closed') || msg.includes('crash');
}

async function hasAnySelector(page: Page, selectors: string[]): Promise<boolean> {
    for (const sel of selectors) {
        const count = await page.locator(sel).count().catch(() => 0);
        if (count > 0) return true;
    }
    return false;
}

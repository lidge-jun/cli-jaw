// Mirrored from agbrowse adaptive-fetch v2; keep runtime behavior aligned while cli-jaw mirror remains experimental.

import type { ReaderCandidate } from './types.js';
import { getFetchBrowserPage, closeFetchBrowserPage } from './browser-runtime.js';
import { assertPublicResolvedHost, validateFetchUrl } from './safety.js';

import type { ResolveHost } from './safety.js';

interface BrowserDepsOption {
    browserDeps?: Record<string, unknown>;
}

interface SessionOptions {
    browserSession?: string;
    browserSessionRaw?: string;
    browserDeps?: Record<string, unknown>;
}

interface NavigateOptions {
    browserDeps?: Record<string, unknown>;
    timeoutMs?: number;
    selector?: string | null;
    allowPrivateNetwork?: boolean;
    resolveHost?: ResolveHost;
}

export function isUserSessionAvailable(options: BrowserDepsOption = {}): boolean {
    const deps: Record<string, unknown> = (options?.browserDeps || {}) as Record<string, unknown>;
    return typeof deps['getPage'] === 'function';
}

export function shouldTryUserSession(candidates: ReaderCandidate[], options: SessionOptions): boolean | 'prompt' {
    const rawSession = options.browserSessionRaw || options.browserSession;
    if (rawSession === 'user' || rawSession === 'interactive') return true;
    const hasChallenge = candidates.some(c =>
        c.challenge?.type === 'challenge' ||
        c.challenge?.type === 'auth_required' ||
        c.challenge?.type === 'paywall'
    );
    if (hasChallenge && isUserSessionAvailable(options)) return 'prompt';
    return false;
}

export async function navigateInUserSession(url: string, options: NavigateOptions) {
    // The existing-session navigation carries the user's real cookies, so a
    // rebound entry URL would send them to a private address and only the body
    // would be discarded afterwards. Clear the entry before the page is taken.
    if (options.allowPrivateNetwork !== true) {
        await assertPublicResolvedHost(url, options.resolveHost, { sensitiveQuery: 'allow' });
    }
    const pageRef = await getFetchBrowserPage({
        ...(options.browserDeps != null ? { browserDeps: options.browserDeps } : {}),
        browserSession: 'existing' as const,
    });
    try {
        const page = pageRef.page as Record<string, unknown>;
        let navStatus = 200;
        let navOk = true;
        if (typeof page['goto'] === 'function') {
            const response: Record<string, unknown> | null = await (page['goto'] as (url: string, opts: Record<string, unknown>) => Promise<Record<string, unknown> | null>)(url, { waitUntil: 'networkidle', timeout: options.timeoutMs || 15000 });
            if (response) {
                navStatus = typeof response['status'] === 'function' ? (response['status'] as () => number)() : ((response['status'] as number) || 200);
                navOk = navStatus >= 200 && navStatus < 400;
            }
        }
        const title: string = typeof page['title'] === 'function' ? await (page['title'] as () => Promise<string>)() : '';
        let text = '';
        if (options.selector && typeof page['locator'] === 'function') {
            const locator = (page['locator'] as (sel: string) => { first: () => { innerText: (opts: { timeout: number }) => Promise<string> } })(options.selector);
            text = await locator.first().innerText({ timeout: 2000 }).catch(() => '');
        } else if (typeof page['evaluate'] === 'function') {
            text = await (page['evaluate'] as (fn: () => string) => Promise<string>)(() => document.body?.innerText || '');
        }
        const finalUrl: string = typeof page['url'] === 'function' ? (page['url'] as () => string)() : url;
        const warnings: string[] = [];
        try {
            validateFetchUrl(finalUrl, options.allowPrivateNetwork != null ? { allowPrivateNetwork: options.allowPrivateNetwork } : {});
            if (options.allowPrivateNetwork !== true) {
                await assertPublicResolvedHost(finalUrl, options.resolveHost, { sensitiveQuery: 'allow' });
            }
        } catch {
            warnings.push('user-session-redirected-to-private-url');
            return {
                source: 'browser_user',
                finalUrl,
                title,
                text: '',
                contentType: 'text/html',
                status: navStatus,
                ok: false,
                session: 'user',
                evidence: ['user-session-render', 'private-url-rejected'],
                warnings,
                safetyFlags: ['user_session_used'],
            };
        }
        return {
            source: 'browser_user',
            finalUrl,
            title,
            text,
            contentType: 'text/html',
            status: navStatus,
            ok: navOk,
            session: 'user',
            evidence: ['user-session-render'],
            warnings,
            safetyFlags: ['user_session_used'],
        };
    } finally {
        await closeFetchBrowserPage(pageRef);
    }
}

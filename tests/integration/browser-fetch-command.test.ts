import test from 'node:test';
import assert from 'node:assert/strict';
import { runAdaptiveFetch } from '../../src/browser/adaptive-fetch/index.js';
import { BrowserRequiredError, getFetchBrowserPage } from '../../src/browser/adaptive-fetch/browser-runtime.js';
import { fetchTextCandidate } from '../../src/browser/adaptive-fetch/fetcher.js';

test('adaptive fetch browser never mode does not call browser dependencies', async () => {
    let browserCalled = false;
    const result = await runAdaptiveFetch({
        url: 'https://example.com/a',
        browserMode: 'never',
        publicEndpoints: false,
    }, {
        fetch: async () => new Response('<title>Weak</title><p>Short</p>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
        }),
        getPage: async () => {
            browserCalled = true;
            return fakePage({});
        },
    });
    assert.equal(browserCalled, false);
    assert.equal(result.chromeUsed, false);
});

test('adaptive fetch keeps archive fallback explicit and browser session strict', async () => {
    const result = await runAdaptiveFetch({
        url: 'https://example.com/a',
        browserMode: 'never',
        publicEndpoints: false,
        allowArchive: true,
    }, {
        fetch: async () => new Response('<title>Weak</title><p>Short</p>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
        }),
    });
    assert.ok(result.warnings.includes('archive-fallback-deferred'));

    let existingCalled = false;
    await assert.rejects(
        () => getFetchBrowserPage({
            browserSession: 'isolated',
            browserDeps: {
                getPage: async () => {
                    existingCalled = true;
                    return fakePage({});
                },
            },
        }),
        BrowserRequiredError,
    );
    assert.equal(existingCalled, false);
});

test('adaptive fetch required browser mode can use isolated page content', async () => {
    const result = await runAdaptiveFetch({
        url: 'https://example.com/spa',
        browserMode: 'required',
        browserSession: 'isolated',
        trace: true,
    }, {
        createIsolatedPage: async () => ({
            page: fakePage({ text: 'Rendered article body '.repeat(120), title: 'Rendered title' }),
            cleanup: async () => undefined,
        }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, 'browser');
    assert.equal(result.chromeUsed, true);
    assert.equal(result.attempts.some((attempt: { source?: string }) => attempt.source === 'browser'), true);
});

test('adaptive fetch does not treat long 404/500 bodies as success', async () => {
    const direct = await runAdaptiveFetch({
        url: 'https://example.com/missing',
        browserMode: 'never',
        publicEndpoints: false,
        trace: true,
    }, {
        fetch: async () => new Response('<article>' + 'Not found '.repeat(500) + '</article>', {
            status: 404,
            headers: { 'content-type': 'text/html' },
        }),
    });
    assert.equal(direct.ok, false);
    assert.equal(direct.verdict, 'blocked');

    for (const status of [404, 500]) {
        const rendered = await runAdaptiveFetch({
            url: `https://example.com/${status}`,
            browserMode: 'required',
            browserSession: 'isolated',
            trace: true,
        }, {
            createIsolatedPage: async () => ({
                page: fakePage({
                    url: `https://example.com/${status}`,
                    title: 'HTTP error',
                    text: 'Server error '.repeat(1000),
                    navResponse: fakeResponse({ status }),
                }),
                cleanup: async () => undefined,
            }),
        });
        assert.equal(rendered.ok, false);
        assert.equal(rendered.verdict, 'blocked');
        assert.equal(rendered.attempts.some((attempt: { source?: string; status?: number }) => attempt.source === 'browser' && attempt.status === status), true);
    }
});

test('adaptive fetch direct fallback and max-byte cancellation are preserved', async () => {
    const fallback = await runAdaptiveFetch({
        url: 'https://github.com/org/repo',
        browserMode: 'never',
        trace: true,
    }, {
        fetch: async (url: URL | RequestInfo) => {
            if (String(url).startsWith('https://api.github.com/')) throw new Error('api down');
            return new Response('<article><h1>Repo</h1><p>' + 'Readable repo body '.repeat(160) + '</p></article>', {
                status: 200,
                headers: { 'content-type': 'text/html' },
            });
        },
    });
    assert.equal(fallback.ok, true);
    assert.equal(fallback.source, 'fetch');
    assert.equal(fallback.attempts.some((attempt: { source?: string; verdict?: string }) => attempt.source === 'public_endpoint' && attempt.verdict === 'error'), true);

    let canceled = false;
    let pulls = 0;
    const stream = new ReadableStream({
        pull(controller) {
            pulls += 1;
            controller.enqueue(new TextEncoder().encode('x'.repeat(64)));
            if (pulls > 10) controller.close();
        },
        cancel() {
            canceled = true;
        },
    });
    const capped = await fetchTextCandidate('https://example.com/large', {
        maxBytes: 80,
        fetchImpl: async () => new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/plain' },
        }),
    });
    assert.equal(capped.ok, false);
    assert.ok(capped.warnings.includes('body-exceeds-max-bytes'));
    assert.equal(canceled, true);
});

function fakePage({
    text = '',
    title = '',
    url = 'https://example.com/rendered',
    networkCandidates = [],
    navResponse = undefined,
}: {
    text?: string;
    title?: string;
    url?: string;
    networkCandidates?: Array<{ finalUrl?: string; text?: string; status?: number }>;
    navResponse?: unknown;
}) {
    return {
        async goto() {
            return navResponse;
        },
        async waitForTimeout() {},
        url: () => url,
        title: async () => title,
        evaluate: async () => text,
        on: async (_event: string, handler: (response: ReturnType<typeof fakeResponse>) => void) => {
            for (const candidate of networkCandidates) handler(fakeResponse(candidate));
        },
        off: () => undefined,
    };
}

function fakeResponse(candidate: { finalUrl?: string; text?: string; status?: number }) {
    return {
        headers: () => ({ 'content-type': 'application/json' }),
        text: async () => candidate.text ?? '',
        url: () => candidate.finalUrl ?? 'https://example.com/data.json',
        status: () => candidate.status ?? 200,
        ok: () => (candidate.status ?? 200) < 400,
    };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type NextFunction, type Request, type Response } from 'express';
import { registerLinkPreviewRoutes } from '../../src/routes/link-preview.ts';
import { withServer as withHttpServer } from '../helpers/with-server.mts';

const realFetch = globalThis.fetch.bind(globalThis);
const publicResolveHost = async () => [{ address: '93.184.216.34', family: 4 }];

function noAuth(_req: Request, _res: Response, next: NextFunction): void {
    next();
}

// Host resolution differs per call. Closing now destroys open connections too,
// which this file did not do before.
const withServer = (
    fn: (baseUrl: string) => Promise<void>,
    options: Parameters<typeof registerLinkPreviewRoutes>[2] = { resolveHost: publicResolveHost },
): Promise<void> => withHttpServer(fn, { setup: app => registerLinkPreviewRoutes(app, noAuth, options) });

function installFetchMock(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: async (url: string | URL | Request, init?: RequestInit) => {
            const text = String(url);
            if (text.startsWith('http://127.0.0.1:')) return realFetch(url, init);
            return handler(text, init);
        },
    });
}

test('link preview metadata route extracts title, description, image, favicon, and canonical URL', async () => {
    installFetchMock(async () => new Response(`<!doctype html><html><head>
        <title>Fallback Title</title>
        <meta name="description" content="Description text">
        <meta property="og:title" content="OpenGraph Title">
        <meta property="og:image" content="/og.png">
        <meta property="og:site_name" content="Example Site">
        <meta property="og:type" content="article">
        <link rel="canonical" href="/canonical">
        <link rel="icon" href="/favicon.ico">
    </head><body></body></html>`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
    }));

    await withServer(async baseUrl => {
        const res = await fetch(`${baseUrl}/api/link-preview?url=${encodeURIComponent('https://example.com/post')}`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.equal(body.data.title, 'OpenGraph Title');
        assert.equal(body.data.description, 'Description text');
        assert.equal(body.data.siteName, 'Example Site');
        assert.equal(body.data.type, 'article');
        assert.equal(body.data.image, 'https://example.com/og.png');
        assert.equal(body.data.favicon, 'https://example.com/favicon.ico');
        assert.equal(body.data.canonicalUrl, 'https://example.com/canonical');
    });
});

test('server registers link preview routes behind requireAuth', () => {
    const serverSrc = readFileSync(join(import.meta.dirname, '../..', 'server.ts'), 'utf8');

    assert.match(serverSrc, /import \{ registerLinkPreviewRoutes \}/);
    assert.match(serverSrc, /registerLinkPreviewRoutes\(app, requireAuth\)/);
});

test('link preview metadata route rejects private and sensitive URLs before fetch', async () => {
    let calls = 0;
    installFetchMock(async () => {
        calls += 1;
        return new Response('', { status: 200 });
    });

    await withServer(async baseUrl => {
        const privateRes = await fetch(`${baseUrl}/api/link-preview?url=${encodeURIComponent('http://127.0.0.1/admin')}`);
        assert.equal(privateRes.status, 400);
        const sensitiveRes = await fetch(`${baseUrl}/api/link-preview?url=${encodeURIComponent('https://example.com/?token=secret')}`);
        assert.equal(sensitiveRes.status, 400);
        assert.equal(calls, 0);
    });
});

test('link preview metadata route rejects DNS-resolved private hosts before fetch', async () => {
    let calls = 0;
    installFetchMock(async () => {
        calls += 1;
        return new Response('<html><head><title>SSRF DNS Proof</title></head></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
        });
    });

    await withServer(async baseUrl => {
        const res = await fetch(`${baseUrl}/api/link-preview?url=${encodeURIComponent('http://public-looking.example/proof')}`);
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error, 'private-network');
        assert.equal(calls, 0);
    }, {
        resolveHost: async () => [{ address: '127.0.0.1', family: 4 }],
    });
});

test('link preview metadata route returns 204 for non-html content', async () => {
    installFetchMock(async () => new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
    }));

    await withServer(async baseUrl => {
        const res = await fetch(`${baseUrl}/api/link-preview?url=${encodeURIComponent('https://example.com/data.json')}`);
        assert.equal(res.status, 204);
        assert.equal(await res.text(), '');
    });
});

test('link preview metadata route rechecks final redirect URL for sensitive query params', async () => {
    installFetchMock(async (url) => {
        if (url === 'https://example.com/redirect') {
            return new Response('', {
                status: 302,
                headers: { location: 'https://example.com/final?token=secret' },
            });
        }
        return new Response('<html><head><title>Unsafe final</title></head></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
        });
    });

    await withServer(async baseUrl => {
        const res = await fetch(`${baseUrl}/api/link-preview?url=${encodeURIComponent('https://example.com/redirect')}`);
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error, 'sensitive-query');
    });
});

test('link preview image proxy rejects SVG images', async () => {
    installFetchMock(async () => new Response('<svg></svg>', {
        status: 200,
        headers: { 'content-type': 'image/svg+xml' },
    }));

    await withServer(async baseUrl => {
        const res = await fetch(`${baseUrl}/api/link-preview/image?url=${encodeURIComponent('https://example.com/icon.svg')}`);
        assert.equal(res.status, 415);
        const body = await res.json();
        assert.equal(body.error, 'unsupported_image_type');
    });
});

test('link preview image proxy rejects bodies over the byte limit', async () => {
    installFetchMock(async () => new Response('x', {
        status: 200,
        headers: {
            'content-type': 'image/png',
            'content-length': String(3 * 1024 * 1024),
        },
    }));

    await withServer(async baseUrl => {
        const res = await fetch(`${baseUrl}/api/link-preview/image?url=${encodeURIComponent('https://example.com/large.png')}`);
        assert.equal(res.status, 413);
        const body = await res.json();
        assert.equal(body.error, 'image_too_large');
    });
});

test('link preview image proxy explicitly omits fetch credentials', async () => {
    let credentials: RequestCredentials | undefined;
    installFetchMock(async (_url, init) => {
        credentials = init?.credentials;
        return new Response('img', {
            status: 200,
            headers: { 'content-type': 'image/png' },
        });
    });

    await withServer(async baseUrl => {
        const res = await fetch(`${baseUrl}/api/link-preview/image?url=${encodeURIComponent('https://example.com/image.png')}`);
        assert.equal(res.status, 200);
        assert.equal(credentials, 'omit');
    });
});

test('link preview image proxy validates redirect hops before following them', async () => {
    installFetchMock(async () => new Response('', {
        status: 302,
        headers: { location: 'http://127.0.0.1/secret.png' },
    }));

    await withServer(async baseUrl => {
        const res = await fetch(`${baseUrl}/api/link-preview/image?url=${encodeURIComponent('https://example.com/redirect')}`);
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error, 'private-network');
    });
});

test('link preview image proxy rejects DNS-resolved private hosts before fetch', async () => {
    let calls = 0;
    installFetchMock(async () => {
        calls += 1;
        return new Response('img', {
            status: 200,
            headers: { 'content-type': 'image/png' },
        });
    });

    await withServer(async baseUrl => {
        const res = await fetch(`${baseUrl}/api/link-preview/image?url=${encodeURIComponent('http://public-looking.example/proof.png')}`);
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error, 'private-network');
        assert.equal(calls, 0);
    }, {
        resolveHost: async () => [{ address: '127.0.0.1', family: 4 }],
    });
});

test('link preview route-local rate limit returns 429 after burst threshold', async () => {
    installFetchMock(async () => new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
    }));

    await withServer(async baseUrl => {
        let lastStatus = 0;
        for (let i = 0; i < 70; i += 1) {
            const res = await fetch(`${baseUrl}/api/link-preview?url=${encodeURIComponent(`https://rate-limit-${i}.example.com`)}`);
            lastStatus = res.status;
            if (lastStatus === 429) break;
        }
        assert.equal(lastStatus, 429);
    });
});

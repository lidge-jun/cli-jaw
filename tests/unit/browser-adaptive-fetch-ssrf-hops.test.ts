import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPublicResolvedHost, type ResolvedAddress } from '../../src/browser/adaptive-fetch/safety.js';
import { fetchTextCandidate } from '../../src/browser/adaptive-fetch/fetcher.js';
import { tlsFetch } from '../../src/browser/adaptive-fetch/tls-fetch.js';
import { ytdlpMetadata } from '../../src/browser/adaptive-fetch/ytdlp-reader.js';
import { fetchViaCamoufox } from '../../src/browser/adaptive-fetch/camoufox-session.js';
import { resolvePublicEndpointCandidates } from '../../src/browser/adaptive-fetch/endpoint-resolvers.js';

// #685: validateFetchUrl only ever inspected the literal hostname, so a
// public-looking name that resolves to loopback, link-local or cloud metadata
// reached the socket on every adaptive-fetch transport. These lock the per-hop
// resolved-address guard, and lock that a caller cannot switch it off.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC: ResolvedAddress[] = [{ address: '93.184.216.34', family: 4 }];
const publicResolveHost = async (): Promise<ResolvedAddress[]> => PUBLIC;
const loopbackResolveHost = async (): Promise<ResolvedAddress[]> => [{ address: '127.0.0.1', family: 4 }];
const metadataResolveHost = async (): Promise<ResolvedAddress[]> => [{ address: '169.254.169.254', family: 4 }];

function rebindingResolveHost(privateHosts: string[]) {
    return async (hostname: string): Promise<ResolvedAddress[]> => (
        privateHosts.includes(hostname)
            ? [{ address: '127.0.0.1', family: 4 }]
            : PUBLIC
    );
}

function countingFetch(handler: (url: string) => Response) {
    const seen: string[] = [];
    const impl = (async (url: string | URL) => {
        seen.push(String(url));
        return handler(String(url));
    }) as unknown as typeof fetch;
    return { impl, seen };
}

function html(body = '<html><body>ok</body></html>'): Response {
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
}

function redirect(location: string): Response {
    return new Response('', { status: 302, headers: { location } });
}

test('AFSSRF-001: assertPublicResolvedHost keeps its strict default and only relaxes the query rule when asked', async () => {
    const withToken = 'https://public.example/article?token=abc';
    // Default (no third argument) must stay byte-for-byte the old behavior, so
    // link-preview and the Slack inbound caller need no edit.
    await assert.rejects(
        () => assertPublicResolvedHost(withToken, publicResolveHost),
        /sensitive query/,
    );
    await assert.doesNotReject(
        () => assertPublicResolvedHost(withToken, publicResolveHost, { sensitiveQuery: 'allow' }),
    );
    // Relaxing the query rule must not relax the address rule.
    await assert.rejects(
        () => assertPublicResolvedHost(withToken, loopbackResolveHost, { sensitiveQuery: 'allow' }),
        /resolved target address is private or local/,
    );
});

test('AFSSRF-002: a rebound host is refused before any request leaves', async () => {
    const { impl, seen } = countingFetch(() => html());
    await assert.rejects(
        () => fetchTextCandidate('http://public-looking.example/proof', {
            fetchImpl: impl,
            resolveHost: loopbackResolveHost,
            sensitiveQuery: 'allow',
        }),
        /resolved target address is private or local/,
    );
    assert.deepEqual(seen, [], 'no request may be issued once the host resolves private');
});

test('AFSSRF-003: cloud metadata behind a public name is refused', async () => {
    const { impl, seen } = countingFetch(() => html());
    await assert.rejects(
        () => fetchTextCandidate('https://harmless.example/', {
            fetchImpl: impl,
            resolveHost: metadataResolveHost,
            sensitiveQuery: 'allow',
        }),
        /resolved target address is private or local/,
    );
    assert.equal(seen.length, 0);
});

test('AFSSRF-004: a redirect whose next hop rebinds is caught on that hop, not after it', async () => {
    const { impl, seen } = countingFetch(url => (
        url === 'https://entry.example/start'
            ? redirect('https://second.example/private')
            : html('<html>private body</html>')
    ));
    await assert.rejects(
        () => fetchTextCandidate('https://entry.example/start', {
            fetchImpl: impl,
            resolveHost: rebindingResolveHost(['second.example']),
            sensitiveQuery: 'allow',
        }),
        /resolved target address is private or local/,
    );
    assert.deepEqual(seen, ['https://entry.example/start'],
        'the first hop is legitimate; the second must never be requested');
});

test('AFSSRF-005: a caller-supplied beforeFetch cannot switch the guard off', async () => {
    const { impl, seen } = countingFetch(() => html());
    let hookCalls = 0;
    await assert.rejects(
        () => fetchTextCandidate('http://public-looking.example/proof', {
            fetchImpl: impl,
            resolveHost: loopbackResolveHost,
            sensitiveQuery: 'allow',
            // A no-op hook is exactly what a caller that does not care would
            // pass, and it used to be the ONLY resolved-address check there was.
            beforeFetch: () => { hookCalls += 1; },
        }),
        /resolved target address is private or local/,
    );
    assert.equal(seen.length, 0);
    assert.equal(hookCalls, 0, 'the built-in guard runs ahead of the hook');
});

test('AFSSRF-006: an explicit allowPrivateNetwork is the only way through', async () => {
    const { impl, seen } = countingFetch(() => html());
    const result = await fetchTextCandidate('http://127.0.0.1/local', {
        fetchImpl: impl,
        resolveHost: loopbackResolveHost,
        allowPrivateNetwork: true,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(seen, ['http://127.0.0.1/local']);
});

test('AFSSRF-007: obfuscated address literals are already normalized by URL parsing', async () => {
    const { impl, seen } = countingFetch(() => html());
    // Node normalizes both of these to 127.0.0.1, so the literal check catches
    // them without any DNS work. Recorded so they are not mistaken for
    // evidence that the resolved-address guard is doing the work.
    for (const target of ['http://2130706433/', 'http://0x7f.0.0.1/']) {
        await assert.rejects(
            () => fetchTextCandidate(target, { fetchImpl: impl, resolveHost: publicResolveHost }),
            /private or local host/,
        );
    }
    assert.equal(seen.length, 0);
});

test('AFSSRF-008: tlsFetch follows redirects itself and clears every hop', async () => {
    const calls: string[][] = [];
    const execFileImpl = async (_binary: string, args: string[]) => {
        calls.push(args);
        const target = args[args.length - 1];
        if (target === 'https://entry.example/start') {
            return { stdout: 'HTTP/2 302\r\nlocation: https://second.example/next\r\n\r\n' };
        }
        return { stdout: 'HTTP/2 200\r\ncontent-type: text/html\r\n\r\n<html>final</html>' };
    };
    const ok = await tlsFetch('https://entry.example/start', {
        execFileImpl,
        resolveHost: publicResolveHost,
    });
    assert.ok(ok, 'a public chain still resolves');
    assert.equal(ok.status, 200);
    assert.equal(ok.body, '<html>final</html>');
    assert.equal(calls.length, 2, 'each hop is a separate request');
    for (const args of calls) {
        assert.equal(args.includes('-L'), false, 'curl must not follow the chain on its own');
    }
});

test('AFSSRF-009: tlsFetch stops at a hop that rebinds to a private address', async () => {
    const calls: string[][] = [];
    const execFileImpl = async (_binary: string, args: string[]) => {
        calls.push(args);
        return { stdout: 'HTTP/2 302\r\nlocation: https://second.example/next\r\n\r\n' };
    };
    const blocked = await tlsFetch('https://entry.example/start', {
        execFileImpl,
        resolveHost: rebindingResolveHost(['second.example']),
    });
    assert.equal(blocked, null);
    assert.equal(calls.length, 1, 'the private hop is never requested');
});

test('AFSSRF-010: the curl argument list no longer contains -L anywhere', () => {
    const source = readFileSync(join(root, 'src/browser/adaptive-fetch/tls-fetch.ts'), 'utf8');
    assert.equal(source.includes("'-L'"), false);
});

test('AFSSRF-011: Camoufox refuses a rebound target before spawning a browser', async () => {
    const result = await fetchViaCamoufox('https://public-looking.example/page', {
        resolveHost: loopbackResolveHost,
        timeoutMs: 1_000,
    });
    assert.equal(result, null);
});

test('AFSSRF-012: Camoufox reports the post-navigation URL and browser-flow trusts only that', () => {
    const session = readFileSync(join(root, 'src/browser/adaptive-fetch/camoufox-session.ts'), 'utf8');
    // The Python used to echo the INPUT url back as "url", which is what let a
    // redirect into a private host pass the caller's final-URL check.
    assert.match(session, /"url": page\.url/);
    assert.equal(session.includes('"url": url'), false);
    assert.match(session, /"requestedUrl": url/);

    const flow = readFileSync(join(root, 'src/browser/adaptive-fetch/browser-flow.ts'), 'utf8');
    assert.equal(flow.includes('camoufoxResult.url || url'), false,
        'falling back to the requested URL defeats the final-URL guard');
    assert.match(flow, /camoufox-final-url-private/);
    assert.match(flow, /assertPublicResolvedHost/);
});

test('AFSSRF-013: yt-dlp is not handed a rebound URL, with or without the binary installed', async () => {
    const result = await ytdlpMetadata('https://public-looking.example/watch?v=x', {
        resolveHost: loopbackResolveHost,
    });
    assert.equal(result, null);
    const source = readFileSync(join(root, 'src/browser/adaptive-fetch/ytdlp-reader.ts'), 'utf8');
    // The caption fetch used to rely on fetch's default redirect following.
    assert.match(source, /redirect: 'manual'/);
});

test('AFSSRF-014: the Mastodon resolver refuses shapes no instance has, and keeps real ones', () => {
    const real = resolvePublicEndpointCandidates('https://mastodon.social/@user/123456');
    assert.equal(real.some(c => c.label === 'mastodon-status-api'), true);

    for (const target of ['https://169.254.169.254/@user/1', 'https://internal/@user/1']) {
        const candidates = resolvePublicEndpointCandidates(target);
        assert.equal(
            candidates.some(c => String(c.label).startsWith('mastodon-')),
            false,
            `${target} must not get a synthesised Mastodon API candidate`,
        );
    }
});


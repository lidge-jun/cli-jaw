import test from 'node:test';
import assert from 'node:assert/strict';
import { executeAdaptiveFetch } from '../../src/browser/adaptive-fetch/scheduler.js';
import { fetchViaCamoufox } from '../../src/browser/adaptive-fetch/camoufox-session.js';
import { tlsFetch } from '../../src/browser/adaptive-fetch/tls-fetch.js';
import type { TlsExecFile } from '../../src/browser/adaptive-fetch/tls-fetch.js';
import { ytdlpMetadata, ytdlpSubtitles } from '../../src/browser/adaptive-fetch/ytdlp-reader.js';
import type { YtdlpExecFile } from '../../src/browser/adaptive-fetch/ytdlp-reader.js';
import type { ResolvedAddress } from '../../src/browser/adaptive-fetch/safety.js';
import type { AdaptiveFetchOptions } from '../../src/browser/adaptive-fetch/types.js';

// The scheduler's internal deadline timer is unref()'d (so production code
// doesn't prevent Node from exiting). In an isolated test subprocess (CI,
// isolation:'process') there are no other ref'd handles, so Node exits before
// the unref'd timer fires → "Promise resolution still pending". A ref'd
// keepalive timer prevents this without changing production behavior.

test('overall deadline aborts an in-flight fetch (P0-6)', { timeout: 10_000 }, async () => {
    const keepAlive = setTimeout(() => {}, 10_000);
    try {
        let sawSignal = false;
        let signalAborted = false;
        const hangingFetch = ((_url: string, init?: RequestInit) => {
            const signal = init?.signal;
            if (signal) sawSignal = true;
            return new Promise<Response>((_resolve, reject) => {
                if (!signal) return;
                if (signal.aborted) { signalAborted = true; reject(new Error('aborted by deadline')); return; }
                signal.addEventListener('abort', () => {
                    signalAborted = true;
                    reject(new Error('aborted by deadline'));
                }, { once: true });
            });
        }) as unknown as typeof fetch;

        const start = Date.now();
        const result = await executeAdaptiveFetch(
            { url: 'https://example.com/', overallTimeoutMs: 500, browserMode: 'never' } as AdaptiveFetchOptions,
            { fetch: hangingFetch },
        );
        const elapsed = Date.now() - start;

        assert.equal(sawSignal, true, 'fetch must receive an AbortSignal from the scheduler');
        assert.equal(signalAborted, true, 'the in-flight fetch signal must be aborted at the overall deadline');
        assert.ok(elapsed < 5000, `executeAdaptiveFetch returned promptly after the 500ms deadline (was ${elapsed}ms)`);
        assert.ok(result && typeof result === 'object', 'returns a final result after deadline abort');
    } finally {
        clearTimeout(keepAlive);
    }
});

test('browser (Camoufox) stage bails immediately when the deadline already fired (P0-6)', { timeout: 10_000 }, async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await fetchViaCamoufox('https://example.com/', { timeoutMs: 30_000, signal: ctrl.signal });
    assert.equal(result, null);
});

test('a fast fetch is not aborted by a generous deadline', { timeout: 10_000 }, async () => {
    const keepAlive = setTimeout(() => {}, 10_000);
    try {
        const okFetch = ((_url: string) => Promise.resolve(new Response('<html><body>hello world content</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
        }))) as unknown as typeof fetch;

        const result = await executeAdaptiveFetch(
            { url: 'https://example.com/', overallTimeoutMs: 60_000, browserMode: 'never' } as AdaptiveFetchOptions,
            { fetch: okFetch },
        );
        assert.ok(result && typeof result === 'object', 'returns a result for a fast fetch');
    } finally {
        clearTimeout(keepAlive);
    }
});

// #693: the overall deadline used to stop at the HTTP paths, so curl-impersonate
// and yt-dlp could outlive it on their own timeout budget. These lock the signal
// reaching both subprocess readers, and the scheduler actually handing it over.

const PUBLIC: ResolvedAddress[] = [{ address: '93.184.216.34', family: 4 }];
const publicResolveHost = async (): Promise<ResolvedAddress[]> => PUBLIC;

/** What promisify(execFile) rejects with when its signal aborts. */
function abortError(): Error {
    const error = new Error('The operation was aborted') as Error & { code?: string };
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    return error;
}

/** Never settles until the signal aborts — what a hung subprocess looks like. */
function hangingExec(seen: { calls: number; withSignal: number }) {
    return (_binary: string, _args: string[], opts: { signal?: AbortSignal }) => {
        seen.calls += 1;
        if (opts.signal) seen.withSignal += 1;
        return new Promise<{ stdout: string }>((_resolve, reject) => {
            const signal = opts.signal;
            if (!signal) return;
            if (signal.aborted) { reject(abortError()); return; }
            signal.addEventListener('abort', () => reject(abortError()), { once: true });
        });
    };
}

function countingExec(seen: { calls: number }) {
    return (_binary: string, _args: string[], _opts: { signal?: AbortSignal }) => {
        seen.calls += 1;
        return Promise.resolve({ stdout: '{}' });
    };
}

test('#693-A tlsFetch does not spawn curl when the deadline already fired', async () => {
    const seen = { calls: 0 };
    const controller = new AbortController();
    controller.abort();
    const result = await tlsFetch('https://example.com/', {
        execFileImpl: countingExec(seen) as TlsExecFile,
        resolveHost: publicResolveHost,
        signal: controller.signal,
    });
    assert.equal(result, null);
    assert.equal(seen.calls, 0, 'curl-impersonate must not be invoked past the deadline');
});

test('#693-B tlsFetch aborts a hanging curl at the deadline', { timeout: 10_000 }, async () => {
    const seen = { calls: 0, withSignal: 0 };
    const controller = new AbortController();
    const fire = setTimeout(() => controller.abort(new Error('overall-deadline-exceeded')), 50);
    try {
        const start = Date.now();
        const result = await tlsFetch('https://example.com/', {
            execFileImpl: hangingExec(seen) as TlsExecFile,
            resolveHost: publicResolveHost,
            signal: controller.signal,
            timeoutMs: 60_000,
        });
        const elapsed = Date.now() - start;
        assert.equal(result, null);
        assert.equal(seen.withSignal, 1, 'the exec double must receive the deadline signal');
        assert.ok(elapsed < 5_000, `tlsFetch returned promptly after the deadline (was ${elapsed}ms)`);
    } finally {
        clearTimeout(fire);
    }
});

test('#693-C ytdlpMetadata does not spawn yt-dlp when the deadline already fired', async () => {
    const seen = { calls: 0 };
    const controller = new AbortController();
    controller.abort();
    const result = await ytdlpMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
        execFileImpl: countingExec(seen) as YtdlpExecFile,
        resolveHost: publicResolveHost,
        signal: controller.signal,
    });
    assert.equal(result, null);
    assert.equal(seen.calls, 0, 'yt-dlp must not be invoked past the deadline');
});

test('#693-D ytdlpMetadata aborts a hanging yt-dlp at the deadline', { timeout: 10_000 }, async () => {
    const seen = { calls: 0, withSignal: 0 };
    const controller = new AbortController();
    const fire = setTimeout(() => controller.abort(new Error('overall-deadline-exceeded')), 50);
    try {
        const start = Date.now();
        const result = await ytdlpMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
            execFileImpl: hangingExec(seen) as YtdlpExecFile,
            resolveHost: publicResolveHost,
            signal: controller.signal,
            timeoutMs: 60_000,
        });
        const elapsed = Date.now() - start;
        assert.equal(result, null);
        assert.equal(seen.withSignal, 1, 'the exec double must receive the deadline signal');
        assert.ok(elapsed < 5_000, `ytdlpMetadata returned promptly after the deadline (was ${elapsed}ms)`);
    } finally {
        clearTimeout(fire);
    }
});

test('#693-E ytdlpSubtitles stops before the caption fetch when the deadline already fired', async () => {
    const seen = { calls: 0 };
    const fetched: string[] = [];
    const controller = new AbortController();
    controller.abort();
    const result = await ytdlpSubtitles('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'en', {
        execFileImpl: countingExec(seen) as YtdlpExecFile,
        fetchImpl: (async (url: string | URL) => {
            fetched.push(String(url));
            return new Response('');
        }) as unknown as typeof fetch,
        resolveHost: publicResolveHost,
        signal: controller.signal,
    });
    assert.equal(result, null);
    assert.equal(seen.calls, 0, 'the metadata subprocess must not run');
    assert.equal(fetched.length, 0, 'the caption CDN must not be reached');
});

test('#693-F the overall deadline returns while the tls fallback is hung', { timeout: 15_000 }, async () => {
    const keepAlive = setTimeout(() => {}, 12_000);
    try {
        // A plain 403 is enough to enter the tls fallback; the scheduler checks
        // status 403/429 before it ever consults the challenge classifier.
        const forbiddenFetch = (async () => new Response('forbidden', {
            status: 403,
            headers: { 'content-type': 'text/html' },
        })) as unknown as typeof fetch;

        const seen = { signal: null as AbortSignal | null };
        const hangingTlsFetch = ((_url: string, opts: { signal?: AbortSignal }) => {
            seen.signal = opts.signal ?? null;
            return new Promise(resolve => {
                const signal = opts.signal;
                if (!signal) return;
                if (signal.aborted) { resolve(null); return; }
                signal.addEventListener('abort', () => resolve(null), { once: true });
            });
        }) as unknown as typeof tlsFetch;

        const start = Date.now();
        const result = await executeAdaptiveFetch(
            { url: 'https://example.com/', overallTimeoutMs: 500, browserMode: 'never' } as AdaptiveFetchOptions,
            { fetch: forbiddenFetch, resolveHost: publicResolveHost, tlsFetchImpl: hangingTlsFetch },
        );
        const elapsed = Date.now() - start;

        assert.ok(seen.signal, 'the scheduler must hand its deadline signal to the tls reader');
        assert.equal(seen.signal?.aborted, true, 'that signal must be aborted at the overall deadline');
        assert.ok(elapsed < 5_000, `executeAdaptiveFetch returned promptly (was ${elapsed}ms)`);
        assert.ok(result && typeof result === 'object', 'a final result is still produced');
    } finally {
        clearTimeout(keepAlive);
    }
});

// #693-G (an executeAdaptiveFetch-level proof for the yt-dlp reader) is
// deliberately absent. The scheduler's 'ytdlp' branch is unreachable today:
// runDirectFetchStage rewrites every resolved candidate to source
// 'public_endpoint' (scheduler.ts:117-120), so the source === 'ytdlp' test at
// scheduler.ts:131 never matches the youtube-ytdlp candidate the resolver
// produces. The reader is wired to the deadline signal all the same, and
// #693-C / #693-D prove that wiring at the function level. Making the branch
// reachable would switch a dormant subprocess reader back on, which is a
// behaviour change this deadline fix has no business making.

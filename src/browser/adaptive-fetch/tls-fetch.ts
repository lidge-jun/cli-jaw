import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertPublicResolvedHost, DEFAULT_REDIRECT_LIMIT, validateFetchUrl } from './safety.js';

import type { ResolveHost } from './safety.js';

const execFileAsync = promisify(execFile);

const PROFILES = ['chrome131', 'safari18_0', 'firefox133'] as const;
type TlsProfile = typeof PROFILES[number];

let cachedBinary: string | null | undefined;

async function detectCurlImpersonate(): Promise<string | null> {
    if (cachedBinary !== undefined) return cachedBinary;
    for (const name of ['curl-impersonate-chrome', 'curl-impersonate', 'curl_chrome131']) {
        try {
            await execFileAsync('which', [name]);
            cachedBinary = name;
            return name;
        } catch { /* not found */ }
    }
    cachedBinary = null;
    return null;
}

function selectProfile(url: string): TlsProfile {
    let hash = 0;
    const hostname = new URL(url).hostname;
    for (let i = 0; i < hostname.length; i++) hash = ((hash << 5) - hash + hostname.charCodeAt(i)) | 0;
    return PROFILES[Math.abs(hash) % PROFILES.length] ?? PROFILES[0];
}

export interface TlsFetchResult {
    ok: boolean;
    status: number;
    headers: Record<string, string>;
    body: string;
    profile: TlsProfile;
}

export type TlsExecFile = (
    binary: string,
    args: string[],
    options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>;

export interface TlsFetchOptions {
    timeoutMs?: number;
    maxBytes?: number;
    proxy?: string;
    redirectLimit?: number;
    resolveHost?: ResolveHost;
    /** Injected for tests; production goes through the detected curl binary. */
    execFileImpl?: TlsExecFile;
}

export async function tlsFetch(
    rawUrl: string,
    options?: TlsFetchOptions,
): Promise<TlsFetchResult | null> {
    const execFileFn: TlsExecFile = options?.execFileImpl
        || ((binary, args, opts) => execFileAsync(binary, args, opts) as Promise<{ stdout: string }>);
    const binary = options?.execFileImpl ? 'curl-impersonate-chrome' : await detectCurlImpersonate();
    if (!binary) return null;

    let current = validateFetchUrl(rawUrl).href;
    const timeout = Math.ceil((options?.timeoutMs || 15_000) / 1000);
    const redirectLimit = Number(options?.redirectLimit ?? DEFAULT_REDIRECT_LIMIT);

    try {
        // curl used to follow the whole chain itself with -L, which meant the
        // private hop was already fetched by the time the final URL was
        // checked, and only the FIRST response's Location was ever inspected.
        // Each hop is now issued separately and cleared before it is issued.
        for (let redirects = 0; redirects <= redirectLimit; redirects += 1) {
            await assertPublicResolvedHost(current, options?.resolveHost, { sensitiveQuery: 'allow' });
            const profile = selectProfile(current);
            const args = [
                '--impersonate', profile,
                '--max-time', String(timeout),
                '--max-filesize', String(options?.maxBytes || 5_000_000),
                '-s',
                '-i',
            ];
            if (options?.proxy) args.push('--proxy', options.proxy);
            args.push(current);
            const { stdout } = await execFileFn(binary, args, { timeout: (timeout + 5) * 1000, maxBuffer: 10_000_000 });

            const sep = stdout.indexOf('\r\n\r\n');
            const headerText = sep > 0 ? stdout.slice(0, sep) : '';
            const body = sep > 0 ? stdout.slice(sep + 4) : stdout;
            const statusMatch = headerText.match(/HTTP\/\S+\s+(\d+)/);
            const status = statusMatch ? Number(statusMatch[1]) : 200;
            const headers: Record<string, string> = {};
            for (const line of headerText.split('\r\n').slice(1)) {
                const idx = line.indexOf(':');
                if (idx > 0) headers[line.slice(0, idx).toLowerCase().trim()] = line.slice(idx + 1).trim();
            }

            const location = extractFinalUrl(headerText);
            if (status >= 300 && status < 400 && location) {
                current = validateFetchUrl(new URL(location, current).href, { allowPrivateNetwork: false }).href;
                continue;
            }
            return { ok: status >= 200 && status < 400, status, headers, body, profile };
        }
        return null;
    } catch {
        return null;
    }
}

function extractFinalUrl(headerText: string): string | null {
    const lines = headerText.split('\r\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const match = lines[i]?.match(/^location:\s*(.+)/i);
        if (match) return match[1]?.trim() || null;
    }
    return null;
}

export { detectCurlImpersonate, selectProfile };

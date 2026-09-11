import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertPublicResolvedHost, DEFAULT_REDIRECT_LIMIT, validateFetchUrl } from './safety.js';

import type { ResolveHost } from './safety.js';

const execFileAsync = promisify(execFile);

let cachedBinary: string | null | undefined;

async function detectYtdlp(): Promise<string | null> {
    if (cachedBinary !== undefined) return cachedBinary;
    for (const name of ['yt-dlp', 'youtube-dl']) {
        try {
            await execFileAsync('which', [name]);
            cachedBinary = name;
            return name;
        } catch { /* not found */ }
    }
    cachedBinary = null;
    return null;
}

export interface YtdlpMetadata {
    title: string;
    description: string;
    duration: number;
    view_count: number;
    upload_date: string;
    uploader: string;
    tags: string[];
    categories: string[];
    thumbnail: string;
    webpage_url: string;
    subtitles?: Record<string, Array<{ ext: string; url: string }>>;
    automatic_captions?: Record<string, Array<{ ext: string; url: string }>>;
}

export interface YtdlpOptions {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    resolveHost?: ResolveHost;
}

export async function ytdlpMetadata(
    url: string,
    options?: YtdlpOptions,
): Promise<YtdlpMetadata | null> {
    // The binary follows its own redirects and fetches related resources, so
    // the only place we can still refuse is before it is handed the URL.
    // This runs ahead of binary detection so the refusal does not depend on
    // yt-dlp being installed.
    try {
        validateFetchUrl(url, { allowPrivateNetwork: false });
        await assertPublicResolvedHost(url, options?.resolveHost, { sensitiveQuery: 'allow' });
    } catch {
        return null;
    }
    const binary = await detectYtdlp();
    if (!binary) return null;
    const timeout = Math.ceil((options?.timeoutMs || 30_000) / 1000);
    try {
        const { stdout } = await execFileAsync(binary, [
            '--dump-json', '--no-download', '--no-warnings',
            '--socket-timeout', String(timeout),
            url,
        ], { timeout: (timeout + 10) * 1000, maxBuffer: 10_000_000 });
        return JSON.parse(stdout) as YtdlpMetadata;
    } catch {
        return null;
    }
}

export async function ytdlpSubtitles(
    url: string,
    lang = 'en',
    options?: YtdlpOptions,
): Promise<string | null> {
    const meta = await ytdlpMetadata(url, options);
    if (!meta) return null;
    const captions = meta.automatic_captions?.[lang] || meta.subtitles?.[lang];
    if (!Array.isArray(captions) || captions.length === 0) return null;
    const vttEntry = captions.find(e => e.ext === 'vtt') || captions[0];
    if (!vttEntry?.url) return null;
    try {
        const fetchFn = options?.fetchImpl || fetch;
        // The caption CDN redirects, and fetch follows by default, so a hop
        // into a private address used to be reached without any check.
        let current = validateFetchUrl(vttEntry.url, { allowPrivateNetwork: false }).href;
        for (let redirects = 0; redirects <= DEFAULT_REDIRECT_LIMIT; redirects += 1) {
            await assertPublicResolvedHost(current, options?.resolveHost, { sensitiveQuery: 'allow' });
            const response = await fetchFn(current, {
                redirect: 'manual',
                signal: AbortSignal.timeout(15_000),
            });
            const location = response.headers.get('location');
            if (response.status >= 300 && response.status < 400 && location) {
                current = validateFetchUrl(new URL(location, current).href, { allowPrivateNetwork: false }).href;
                continue;
            }
            if (!response.ok) return null;
            return extractSubtitleText(await response.text());
        }
        return null;
    } catch {
        return null;
    }
}

function extractSubtitleText(raw: string): string {
    return raw
        .replace(/WEBVTT[\s\S]*?\n\n/, '')
        .replace(/\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}.*\n/g, '')
        .replace(/<[^>]+>/g, '')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .join(' ');
}

export function formatYtdlpEvidence(meta: YtdlpMetadata, subtitles?: string | null): string {
    const lines = [
        `Title: ${meta.title || 'N/A'}`,
        `Uploader: ${meta.uploader || 'N/A'}`,
        meta.duration ? `Duration: ${Math.floor(meta.duration / 60)}m${Math.round(meta.duration % 60)}s` : null,
        meta.view_count ? `Views: ${meta.view_count.toLocaleString()}` : null,
        meta.upload_date ? `Upload: ${meta.upload_date}` : null,
        meta.description ? `Description: ${meta.description.slice(0, 500)}` : null,
        subtitles ? `\nTranscript:\n${subtitles.slice(0, 3000)}` : null,
    ].filter((v): v is string => v != null);
    return lines.join('\n');
}

export { detectYtdlp };

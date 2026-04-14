// ─── CLI API Auth Helper ─────────────────────────────
// CLI → server HTTP 호출 시 Authorization 헤더 자동 삽입

import { getServerUrl } from '../core/config.js';

let _cachedToken: string | null = null;
let _cachedBase: string | null = null;

export async function getCliAuthToken(portOrBase?: string | number): Promise<string> {
    const base = portOrBase && String(portOrBase).startsWith('http')
        ? String(portOrBase)
        : getServerUrl(portOrBase);

    if (_cachedBase && _cachedBase !== base) _cachedToken = null;
    _cachedBase = base;

    if (_cachedToken) return _cachedToken;
    try {
        const res = await fetch(`${base}/api/auth/token`);
        if (res.ok) {
            const json = await res.json() as { token?: string };
            _cachedToken = json.token || '';
        }
    } catch { /* server may not be running */ }
    return _cachedToken || '';
}

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (_cachedToken) h['Authorization'] = `Bearer ${_cachedToken}`;
    return h;
}

export async function cliFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const parsed = new URL(url);
    await getCliAuthToken(parsed.origin);
    const headers = authHeaders(
        init.headers ? Object.fromEntries(
            init.headers instanceof Headers ? init.headers.entries() :
            Array.isArray(init.headers) ? init.headers :
            Object.entries(init.headers)
        ) as Record<string, string> : undefined
    );
    return fetch(url, { ...init, headers });
}

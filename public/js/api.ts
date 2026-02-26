// ── API Fetch Wrapper ──
// All API calls centralized for error handling + ok/data unwrapping

interface ApiResponse<T = unknown> {
    ok?: boolean;
    data?: T;
    error?: string;
}

/**
 * @param path - API path (e.g. '/api/settings')
 * @param opts - fetch options
 * @returns data on success, null on failure
 */
export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T | null> {
    try {
        const res = await fetch(path, opts);
        if (!res.ok) {
            console.warn(`[api] ${opts.method || 'GET'} ${path} → ${res.status}`);
            return null;
        }
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('json')) return null;
        const json = (await res.json()) as ApiResponse<T>;
        // Phase 9.2 dual-response compat: { ok, data } or bare response
        if (json && typeof json === 'object' && 'ok' in json && 'data' in json) {
            if (!json.ok) {
                console.warn(`[api] ${path} → ok:false`, json.error || '');
                return null;
            }
            return json.data as T;
        }
        return json as unknown as T;
    } catch (e) {
        console.warn(`[api] ${path} failed:`, (e as Error).message);
        return null;
    }
}

/**
 * POST/PUT/DELETE JSON request
 */
export async function apiJson<T = unknown>(path: string, method: string, body: unknown): Promise<T | null> {
    return api<T>(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

/**
 * fire-and-forget: ignores result
 */
export function apiFire(path: string, method: string = 'POST', body?: unknown): void {
    const opts: RequestInit = { method };
    if (body) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
    }
    fetch(path, opts).catch(() => { });
}

/**
 * One Slack fetch harness for the Slack unit tests.
 *
 * Six files had grown their own `makeFetch` under the same comment, and the
 * copies had stopped agreeing: only history coerced numeric form values, only
 * roster routed responses by Slack method, and only outbound could produce a
 * non-200 status, a `retry-after` header or an empty body. The other five were
 * pinned to "always HTTP 200 with ok:true", so a 429 or an `invalid_arguments`
 * fixture written in one file proved nothing about the rest.
 *
 * Seam: `slackApi` (src/slack/api.ts) never reads `response.ok` or
 * `response.json()`. It reads `status`, optionally `headers.get('retry-after')`
 * and `headers.get('x-oauth-scopes')`, then `text()` — or `body.getReader()`
 * when one is present, which is why this harness deliberately omits `body` and
 * lets `readBoundedResponse` fall back to `text()`. `headers` is a real
 * `Headers` instance because `parseRetryAfterMs` calls `.get` on it; a plain
 * object throws there and `slackApi` reports the throw as status 502.
 *
 * The one caller that reads the transport directly is
 * `src/slack/slack-file.ts` step 2: it POSTs to the presigned upload URL and
 * checks `upload.ok` / `upload.status` without a body. That is what
 * `slackRaw()` is for.
 */

/** A Slack JSON body. `__status` and `__headers` shape the HTTP envelope. */
export type SlackJsonSpec = Record<string, unknown> & {
    __status?: number;
    __headers?: Record<string, string>;
};

/** A transport-level response: HTTP ok/status decided directly, body optional. */
export type SlackRawSpec = {
    __raw: true;
    ok: boolean;
    status: number;
    headers?: Record<string, string>;
    text?: string;
};

export type SlackFetchSpec = SlackJsonSpec | SlackRawSpec;

export type SlackFetchCall = {
    url: string;
    /**
     * The Slack RPC name, taken from the last URL segment — `users.list`, not
     * `POST`. The HTTP verb stays on `init.method`, which is where
     * slack-outbound reads it.
     */
    method: string;
    /** Parsed request body. Non-string bodies (FormData) record as `{}`. */
    body: Record<string, unknown>;
    /**
     * The original `init`, by reference. Not cloned and not normalized:
     * slack-outbound indexes `init.headers` as a plain object, compares
     * `String(init.body)` to a form string, and asserts `body instanceof
     * FormData`. Wrapping or serializing any of that would make those checks
     * vacuous.
     */
    init: RequestInit | undefined;
};

export type SlackFetchOptions = {
    /**
     * Coerce digit-only form values to numbers. On by default: history asserts
     * `body.limit === 10`, and no test compares a digit-only value to a string
     * (`ts`, `oldest` and `latest` all carry a dot, so they stay strings).
     */
    coerceNumeric?: boolean;
};

export type SlackFetchHarness = {
    impl: typeof fetch;
    calls: SlackFetchCall[];
};

/** Slack application error on HTTP 200 — the documented Slack failure shape. */
export function slackError(error: string, extra: Record<string, unknown> = {}): SlackJsonSpec {
    return { ok: false, error, ...extra };
}

/** `invalid_arguments`, which is what Slack returns for a JSON-encoded form call. */
export function slackInvalidArguments(extra: Record<string, unknown> = {}): SlackJsonSpec {
    return slackError('invalid_arguments', extra);
}

/**
 * A real rate limit: HTTP 429, a `retry-after` header, and the `ratelimited`
 * error string. The string matters — `isRetryableSlackError` and
 * `noRetryOnRateLimit` both match it exactly, and a bare `{ ok: false }`
 * degrades to `unknown_error`, which is not retryable and would let a
 * "one call only" assertion pass without touching the retry path at all.
 */
export function slackRateLimited(retryAfterSeconds: number): SlackJsonSpec {
    return {
        ok: false,
        error: 'ratelimited',
        __status: 429,
        __headers: { 'retry-after': String(retryAfterSeconds) },
    };
}

/** A transport-level response, for the presigned upload POST and table readback. */
export function slackRaw(spec: Omit<SlackRawSpec, '__raw'>): SlackRawSpec {
    return { __raw: true, ...spec };
}

function isRaw(spec: SlackFetchSpec): spec is SlackRawSpec {
    return '__raw' in spec && spec.__raw === true;
}

function parseBody(init: RequestInit | undefined, coerceNumeric: boolean): Record<string, unknown> {
    const raw = init?.body;
    if (typeof raw !== 'string') return {};
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            const parsed: unknown = JSON.parse(trimmed);
            return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
        } catch {
            return {};
        }
    }
    const body: Record<string, unknown> = {};
    for (const [key, value] of new URLSearchParams(raw)) {
        body[key] = coerceNumeric && /^\d+$/.test(value) ? Number(value) : value;
    }
    return body;
}

function respond(spec: SlackFetchSpec | undefined): Response {
    const chosen: SlackFetchSpec = spec ?? { ok: true };
    if (isRaw(chosen)) {
        const text = chosen.text ?? '';
        return {
            ok: chosen.ok,
            status: chosen.status,
            headers: new Headers(chosen.headers ?? {}),
            text: async () => text,
        // justified: the harness implements only the Response surface slackApi reads
        } as unknown as Response;
    }
    const record: SlackJsonSpec = { ...chosen };
    const status = typeof record['__status'] === 'number' ? record['__status'] : 200;
    const headers = new Headers(record['__headers'] ?? {});
    delete record['__status'];
    delete record['__headers'];
    return {
        // HTTP ok stays true for a JSON spec: Slack reports application errors
        // as `{ ok: false }` on a 200, and even its 429 carries a JSON body.
        ok: true,
        status,
        headers,
        text: async () => JSON.stringify(record),
    // justified: the harness implements only the Response surface slackApi reads
    } as unknown as Response;
}

/**
 * Build an injectable `fetch` plus the calls it recorded.
 *
 * Pass an array to replay responses in order, or an object keyed by Slack
 * method to replay per method. Both exhaust to their LAST spec rather than
 * running out: roster's membership ceiling and `users.list` cap each hand over
 * one page that always carries a cursor and then assert the call count, so
 * replay is what bounds those loops. An unscripted method answers `{ ok: true }`.
 */
export function makeSlackFetch(
    specs: SlackFetchSpec[] | Record<string, SlackFetchSpec[]>,
    options: SlackFetchOptions = {},
): SlackFetchHarness {
    const coerceNumeric = options.coerceNumeric !== false;
    const calls: SlackFetchCall[] = [];
    const sequential = Array.isArray(specs) ? specs : null;
    const script = Array.isArray(specs) ? null : specs;
    let index = 0;
    const cursors: Record<string, number> = {};

    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        const method = href.split('/').pop() ?? '';
        calls.push({ url: href, method, body: parseBody(init, coerceNumeric), init });
        if (sequential) {
            const spec = sequential[Math.min(index, sequential.length - 1)];
            index += 1;
            return respond(spec);
        }
        const queue = script?.[method] ?? [{ ok: true }];
        const at = Math.min(cursors[method] ?? 0, queue.length - 1);
        cursors[method] = (cursors[method] ?? 0) + 1;
        return respond(queue[at]);
    }) as unknown as typeof fetch;

    return { impl, calls };
}

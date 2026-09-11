// Dynamic lookup contract: conversations.history/replies wrappers, formatting,
// and the retry/error surfaces.
import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    fetchSlackHistory,
    fetchSlackReplies,
    formatHistoryForAgent,
    SLACK_HISTORY_MAX_LIMIT,
    type SlackHistoryMessage,
} from '../../src/slack/history.ts';
import { makeSlackFetch } from '../helpers/slack-fetch.mts';

const TOKEN = 'xoxb-not-a-real-token-000';

test('fetchSlackHistory normalizes messages and hasMore', async () => {
    const { impl, calls } = makeSlackFetch([{
        ok: true,
        has_more: true,
        messages: [
            { ts: '2.0', user: 'U1', text: 'later', thread_ts: '1.0', reply_count: 3 },
            { ts: '1.0', bot_id: 'B1', text: 'earlier' },
            { text: 'no ts — dropped' },
        ],
    }]);
    const result = await fetchSlackHistory(TOKEN, 'C1', { limit: 10, fetchImpl: impl });
    assert.ok(result.ok);
    assert.equal(result.hasMore, true);
    assert.deepEqual(result.messages, [
        { ts: '2.0', threadTs: '1.0', user: 'U1', text: 'later', replyCount: 3 },
        { ts: '1.0', botId: 'B1', text: 'earlier' },
    ] satisfies SlackHistoryMessage[]);
    assert.ok(calls[0]!.url.endsWith('/conversations.history'));
    assert.equal(calls[0]!.body['channel'], 'C1');
    assert.equal(calls[0]!.body['limit'], 10);
});

test('fetchSlackReplies passes the thread ts and clamps the limit', async () => {
    const { impl, calls } = makeSlackFetch([{ ok: true, messages: [{ ts: '1.0', user: 'U1', text: 'parent' }] }]);
    const result = await fetchSlackReplies(TOKEN, 'C1', '1.0', { limit: 9999, fetchImpl: impl });
    assert.ok(result.ok);
    assert.ok(calls[0]!.url.endsWith('/conversations.replies'));
    assert.equal(calls[0]!.body['ts'], '1.0');
    assert.equal(calls[0]!.body['limit'], SLACK_HISTORY_MAX_LIMIT);
});

test('limit clamps low end to 1', async () => {
    const { impl, calls } = makeSlackFetch([{ ok: true, messages: [] }]);
    await fetchSlackHistory(TOKEN, 'C1', { limit: 0, fetchImpl: impl });
    // 0 is falsy → default 50, negative clamps to 1
    assert.equal(calls[0]!.body['limit'], 50);
    await fetchSlackHistory(TOKEN, 'C1', { limit: -5, fetchImpl: impl });
    assert.equal(calls[1]!.body['limit'], 1);
});

test('missing_scope surfaces the needed scope and never the token', async () => {
    const { impl } = makeSlackFetch([{ ok: false, error: 'missing_scope', needed: 'mpim:history' }]);
    const result = await fetchSlackHistory(TOKEN, 'G-mpim', { fetchImpl: impl });
    assert.ok(!result.ok);
    assert.match(result.error, /mpim:history/);
    assert.ok(!result.error.includes(TOKEN), 'token must never appear in error output');
});

test('ratelimited retries once and succeeds (activation: retry path fires)', async () => {
    const { impl, calls } = makeSlackFetch([
        { ok: false, error: 'ratelimited' },
        { ok: true, messages: [{ ts: '1.0', user: 'U1', text: 'after retry' }] },
    ]);
    const started = Date.now();
    const result = await fetchSlackHistory(TOKEN, 'C1', { fetchImpl: impl });
    assert.ok(result.ok);
    assert.equal(result.messages[0]!.text, 'after retry');
    assert.equal(calls.length, 2, 'exactly one retry');
    assert.ok(Date.now() - started >= 950, 'backoff pause observed');
});

test('non-retryable errors do not retry', async () => {
    const { impl, calls } = makeSlackFetch([{ ok: false, error: 'channel_not_found' }]);
    const result = await fetchSlackHistory(TOKEN, 'CBAD', { fetchImpl: impl });
    assert.ok(!result.ok);
    assert.equal(calls.length, 1);
    assert.match(result.error, /not found|not a member/);
});

test('formatHistoryForAgent renders chronologically, marks self, caps length', () => {
    const messages: SlackHistoryMessage[] = [
        { ts: '200.0', user: 'U2', text: 'second' },
        { ts: '100.0', user: 'UBOT', text: 'first (from the bot)' },
        { ts: '300.0', botId: 'B9', text: 'third', replyCount: 2 },
    ];
    const text = formatHistoryForAgent(messages, 'UBOT');
    const lines = text.split('\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0]!, /bot\(self\): first/);
    assert.match(lines[1]!, /<@U2>: second/);
    assert.match(lines[2]!, /bot:B9: third \[2 replies\]/);
    // cap — raised to 12000 with the preamble in #518, because this cut runs
    // first and in the same direction, so at 6000 it was the real ceiling and
    // raising PREAMBLE_TOTAL_CAP alone changed nothing.
    const big = formatHistoryForAgent(
        Array.from({ length: 400 }, (_, i) => ({ ts: `${i}.0`, user: 'U1', text: 'x'.repeat(100) })),
    );
    assert.ok(big.length <= 12000, `history render stays bounded, got ${big.length}`);
    // The bound keeps the NEWEST messages: an overflowing history that dropped
    // its tail is what made the agent answer about the wrong part of a thread.
    assert.ok(big.includes('[1970-01-01 00:06]'), 'the most recent rendered line survives the cut');
});

test('a token pasted into a Slack message is redacted from formatted output', () => {
    // Assembled at runtime so secret scanners never see a token-shaped literal.
    const pastedToken = ['xoxb', '1234567890123', '4567890123456', 'AbCdEfGhIjKlMnOpQrStUvWx'].join('-');
    const text = formatHistoryForAgent([
        { ts: '1.0', user: 'U1', text: `my token is ${pastedToken}` },
    ]);
    assert.ok(!text.includes(pastedToken.slice(0, 18)), 'pasted token must be redacted');
});

test('fetchSlackReplies forwards and returns the pagination cursor', async () => {
    const { impl, calls } = makeSlackFetch([{
        ok: true, messages: [], response_metadata: { next_cursor: 'cursor-next' },
    }]);
    const result = await fetchSlackReplies(TOKEN, 'C1', '1.0', {
        cursor: 'cursor-current', fetchImpl: impl,
    });
    assert.ok(result.ok);
    assert.equal(calls[0]?.body['cursor'], 'cursor-current');
    assert.equal(result.nextCursor, 'cursor-next');
});

// ─── route contract (handler-level, slack-manifest-route pattern) ──

test('GET /api/slack/history rejects a missing channel and reports slack-off', async () => {
    const { registerMessagingRoutes } = await import('../../src/routes/messaging.ts');
    const handlers = new Map<string, (req: unknown, res: unknown) => Promise<void> | void>();
    const app = {
        get: (path: string, ...fns: Array<(req: unknown, res: unknown) => void>) => {
            handlers.set(path, fns[fns.length - 1]!);
        },
        post: () => { /* not under test */ },
        use: () => { /* not under test */ },
    };
    const passAuth = (_req: unknown, _res: unknown, next: () => void) => next();
    registerMessagingRoutes(app as never, passAuth as never);
    const handler = handlers.get('/api/slack/history');
    assert.ok(handler, 'route not registered');

    // Slack is disabled in the isolated home → the client gate fires first.
    let status = 0;
    let payload: Record<string, unknown> = {};
    const res = {
        status: (code: number) => { status = code; return res; },
        json: (body: unknown) => { payload = body as Record<string, unknown>; },
    };
    await handler({ query: { channel: 'C1' } }, res);
    assert.equal(status, 503);
    assert.equal(payload['error'], 'slack_disabled');
});

test('history rich payload and cursor-only continuation survive normalization', async () => {
    const blocks = [{ type: 'table', rows: [[{ type: 'raw_text', text: 'Item' }], [{ type: 'raw_text', text: 'Value' }]] }];
    const { impl } = makeSlackFetch([{ ok: true, messages: [{ ts: '2.0', blocks, reactions: [{ name: 'eyes', count: 2 }], edited: { ts: '3.0' } }], response_metadata: { next_cursor: 'next' } }]);
    const result = await fetchSlackHistory(TOKEN, 'C1', { fetchImpl: impl });
    assert.ok(result.ok);
    assert.equal(result.hasMore, true);
    assert.deepEqual(result.messages[0]?.blocks, blocks);
    assert.match(result.messages[0]?.text ?? '', /Item[\s\S]*Value/);
    assert.equal(result.messages[0]?.edited?.ts, '3.0');
});

test('replies forwards time bounds and inclusive', async () => {
    const { impl, calls } = makeSlackFetch([{ ok: true, messages: [] }]);
    await fetchSlackReplies(TOKEN, 'C1', '1.0', { oldest: '2.0', latest: '3.0', inclusive: true, fetchImpl: impl });
    assert.equal(calls[0]?.body.oldest, '2.0');
    assert.equal(calls[0]?.body.latest, '3.0');
    assert.equal(calls[0]?.body.inclusive, 'true');
});

test('oversized newest message retains a bounded excerpt and exact timestamp', () => {
    const output = formatHistoryForAgent([{ ts: '1700000000.123456', text: 'x'.repeat(13000) }]);
    assert.ok(output.length > 0 && output.length <= 12000);
    assert.match(output, /truncated/);
    assert.match(output, /1700000000\.123456/);
});

test('agent JSON redacts rich strings without damaging internal file downloads', async () => {
    const { slackHistoryForAgent } = await import('../../src/slack/history.ts');
    const secret = ['xoxb', '1234567890123', '4567890123456', 'AbCdEfGhIjKlMnOpQrStUvWx'].join('-');
    const download = 'https://files.slack.com/files-pri/T1-F1/download';
    const internal: SlackHistoryMessage[] = [{ ts: '1.0', text: secret, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: secret } }], files: [{ id: 'F1', url_private_download: download }] }];
    const projected = slackHistoryForAgent(internal);
    assert.ok(!JSON.stringify(projected).includes(secret));
    assert.ok(!JSON.stringify(projected).includes(download));
    assert.equal(internal[0]?.files?.[0]?.url_private_download, download);
    assert.equal(internal[0]?.text, secret);
});

test('rich projection bounds hostile graphs and ignores prototype keys', async () => {
    const { slackHistoryForAgent } = await import('../../src/slack/history.ts');
    const block: Record<string, unknown> = JSON.parse('{"__proto__":{"polluted":true},"type":"section"}');
    block['elements'] = [block, { text: 'x'.repeat(100000) }];
    const result = slackHistoryForAgent([{ ts: '1.0', text: 'safe', blocks: [block] }]);
    assert.equal(result[0]?.contentTruncated, true);
    assert.ok(JSON.stringify(result).length < 65000);
    assert.equal(Object.getPrototypeOf(result[0]?.blocks?.[0]), Object.prototype);
    assert.ok(!JSON.stringify(result).includes('__proto__'));
});

test('HTTP history forwards pagination and rejects malformed options before Slack', async t => {
    const { settings } = await import('../../src/core/config.ts');
    const original = settings.slack;
    settings.slack = { ...original, enabled: true, botToken: TOKEN };
    t.after(() => { settings.slack = original; });
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    const calls: URLSearchParams[] = [];
    const secret = ['xoxb', '1234567890123', '4567890123456', 'AbCdEfGhIjKlMnOpQrStUvWx'].join('-');
    globalThis.fetch = async (_url, init) => {
        const body = new URLSearchParams(String(init?.body)); calls.push(body);
        return new Response(JSON.stringify({ ok: true, messages: [{ ts: body.get('cursor') ? '3.0' : '2.0', text: secret }], response_metadata: { next_cursor: body.get('cursor') ? '' : 'next' } }));
    };
    const { registerMessagingRoutes } = await import('../../src/routes/messaging.ts');
    const handlers = new Map<string, (req: unknown, res: unknown) => Promise<void>>();
    const app = { get: (path: string, ...fns: Array<(req: unknown, res: unknown) => Promise<void>>) => handlers.set(path, fns.at(-1)!), post() {}, use() {} };
    registerMessagingRoutes(app as never, ((_req: unknown, _res: unknown, next: () => void) => next()) as never, { validateSlackOperator: candidate => candidate === 'fixture-operator' });
    const handler = handlers.get('/api/slack/history')!;
    let status = 200; let payload: Record<string, unknown> = {};
    const res = { status(code: number) { status = code; return res; }, json(body: Record<string, unknown>) { payload = body; } };
    await handler({ headers: { 'x-jaw-slack-operator': 'fixture-operator' }, query: { channel: 'C1', oldest: '1.0', latest: '4.0', inclusive: 'true' } }, res);
    assert.equal(payload.nextCursor, 'next'); assert.equal(payload.partial, true);
    assert.ok(!JSON.stringify(payload).includes(secret));
    await handler({ headers: { 'x-jaw-slack-operator': 'fixture-operator' }, query: { channel: 'C1', thread_ts: '1.0', cursor: 'next', oldest: '1.0', latest: '4.0', inclusive: 'true', format: 'text' } }, res);
    assert.equal(payload.hasMore, false); assert.equal(payload.fetchedCount, 1);
    assert.equal(calls[1]?.get('cursor'), 'next'); assert.equal(calls[1]?.get('oldest'), '1.0'); assert.equal(calls[1]?.get('inclusive'), 'true');
    for (const query of [{ limit: '-1' }, { inclusive: 'maybe' }, { cursor: ['a', 'b'] }, { oldest: 'later' }, { unexpected: 'value' }]) {
        await handler({ query: { channel: 'C1', ...query } }, res);
        assert.equal(status, 400);
    }
    assert.equal(calls.length, 2);
});

test('normalized oversized blocks cannot evict ts/text from agent output', async () => {
    const { slackHistoryForAgent, formatHistoryForAgentDetailed } = await import('../../src/slack/history.ts');
    const { impl } = makeSlackFetch([{ ok: true, messages: [{ ts: '1.0', text: 'required body', blocks: [{ text: 'x'.repeat(64000) }] }] }]);
    const fetched = await fetchSlackHistory(TOKEN, 'C1', { fetchImpl: impl });
    assert.ok(fetched.ok);
    const messages = slackHistoryForAgent(fetched.messages);
    assert.equal(messages[0]?.ts, '1.0'); assert.equal(messages[0]?.text, 'required body');
    assert.doesNotThrow(() => formatHistoryForAgentDetailed(messages));
    assert.equal(messages[0]?.contentTruncated, true);
});

test('agent rich budget includes long keys and multibyte JSON strings', async () => {
    const { slackHistoryForAgent } = await import('../../src/slack/history.ts');
    for (const block of [{ ['k'.repeat(100000)]: 'v' }, { text: '한글'.repeat(40000) }]) {
        const messages = slackHistoryForAgent([{ ts: '1.0', text: 'body', blocks: [block] }]);
        assert.ok(Buffer.byteLength(JSON.stringify(messages)) < 65000);
        assert.equal(messages[0]?.contentTruncated, true);
        assert.equal(messages[0]?.text, 'body');
    }
});

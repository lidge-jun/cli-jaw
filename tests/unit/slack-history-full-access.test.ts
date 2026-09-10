import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import Database from 'better-sqlite3';
import { registerMessagingRoutes } from '../../src/routes/messaging.ts';
import { settings } from '../../src/core/config.ts';
import { isFullAccessRequest } from '../../src/http/full-access.ts';
import { configureRtsOutputStore, RtsOutputStore } from '../../src/slack/rts-output-store.ts';
import { reserveSlackToolGrant, activateSlackToolGrant, revokeSlackToolScope, slackCredentialKey } from '../../src/slack/tool-context.ts';

const TOKEN = 'xoxb-full-history-fixture';
const CHANNEL = 'C192TEST';
const PARENT = '1700000000.000001';
type MessagingOptions = Parameters<typeof registerMessagingRoutes>[2] & {
    isFullAccess?: (req: Request) => boolean;
};

function replies(count: number) {
    return Array.from({ length: count }, (_, i) => ({
        ts: '1700000000.' + String(i + 1).padStart(6, '0'),
        user: 'U1',
        text: i === 0 ? 'early-root' : i === count - 1 ? 'late-192' : 'm' + i,
    }));
}

async function withHistoryServer(
    options: { isFullAccess?: (req: Request) => boolean; slackError?: string; pages?: Record<string, Record<string, unknown>> },
    run: (baseUrl: string, calls: Array<{ method: string; body: URLSearchParams }>) => Promise<void>,
): Promise<void> {
    const previous = settings.slack;
    const db = new Database(':memory:');
    configureRtsOutputStore(new RtsOutputStore(db));
    settings.slack = { ...previous, enabled: true, botToken: TOKEN, channelIds: [] };
    const calls: Array<{ method: string; body: URLSearchParams }> = [];
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
        const method = String(url).split('/').at(-1)!;
        const body = new URLSearchParams(String(init?.body ?? ''));
        calls.push({ method, body });
        if (!String(url).includes('slack.com/api/')) return savedFetch(url, init);
        if (options.slackError) return new Response(JSON.stringify({ ok: false, error: options.slackError }));
        if (method === 'auth.test') return new Response(JSON.stringify({ ok: true, team_id: 'T1', user_id: 'UBOT' }));
        if (method === 'conversations.info') {
            return new Response(JSON.stringify({ ok: true, channel: { id: body.get('channel'), is_shared: false, is_ext_shared: false, context_team_id: 'T1' } }));
        }
        if (method === 'conversations.members') {
            return new Response(JSON.stringify({ ok: true, members: ['U1', 'UBOT'], response_metadata: { next_cursor: '' } }));
        }
        const cursor = body.get('cursor') || '';
        const page = options.pages?.[cursor] ?? options.pages?.[''];
        if (page) return new Response(JSON.stringify(page));
        if (method === 'conversations.replies' || method === 'conversations.history') {
            return new Response(JSON.stringify({ ok: true, messages: replies(192), has_more: false, response_metadata: { next_cursor: '' } }));
        }
        throw new Error('unexpected Slack method ' + method);
    }) as typeof fetch;
    const app = express();
    app.use(express.json());
    const passAuth = (_req: Request, _res: Response, next: NextFunction) => next();
    registerMessagingRoutes(app, passAuth, {
        validateSlackOperator: candidate => candidate === 'fixture-operator',
        isFullAccess: options.isFullAccess,
    } as MessagingOptions);
    const server: Server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    try {
        await run('http://127.0.0.1:' + address.port, calls);
    } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        globalThis.fetch = savedFetch;
        settings.slack = previous;
        configureRtsOutputStore(undefined);
        db.close();
        revokeSlackToolScope();
    }
}

test('HIST-192: headerless Auto HTTP returns 192 replies including the early root', async () => {
    let invocations = 0;
    await withHistoryServer({ isFullAccess: req => { invocations += 1; return isFullAccessRequest(req, 'auto'); } }, async (baseUrl, calls) => {
        const response = await fetch(baseUrl + '/api/slack/history?channel=' + CHANNEL + '&thread_ts=' + PARENT + '&limit=200');
        const body = await response.json() as {
            ok?: boolean; messages?: Array<{ ts?: string; text?: string }>; fetchedCount?: number;
            hasMore?: boolean; partial?: boolean; nextCursor?: string;
        };
        assert.equal(response.status, 200);
        assert.equal(body.ok, true);
        assert.equal(body.messages?.length, 192);
        assert.equal(body.fetchedCount, 192);
        assert.equal(body.hasMore, false);
        assert.equal(body.partial, false);
        assert.equal(body.messages?.[0]?.ts, PARENT);
        assert.equal(body.messages?.[0]?.text, 'early-root');
        assert.equal(body.messages?.[191]?.text, 'late-192');
        assert.equal(body.nextCursor, undefined);
        const repliesCall = calls.find(call => call.method === 'conversations.replies');
        assert.ok(repliesCall);
        assert.equal(repliesCall.body.get('limit'), '200');
        assert.equal(repliesCall.body.get('channel'), CHANNEL);
        assert.equal(invocations, 1);
    });
});

test('HIST-EARLY: channel cursor page returns the older row', async () => {
    await withHistoryServer({
        isFullAccess: () => true,
        pages: {
            '': { ok: true, messages: [{ ts: '1700000000.000900', user: 'U1', text: 'newer' }], has_more: true, response_metadata: { next_cursor: 'p2' } },
            p2: { ok: true, messages: [{ ts: '1700000000.000010', user: 'U1', text: 'early-page' }], has_more: false, response_metadata: { next_cursor: '' } },
        },
    }, async baseUrl => {
        const first = await (await fetch(baseUrl + '/api/slack/history?channel=' + CHANNEL)).json() as { hasMore?: boolean; nextCursor?: string };
        assert.equal(first.hasMore, true);
        assert.equal(first.nextCursor, 'p2');
        const second = await (await fetch(baseUrl + '/api/slack/history?channel=' + CHANNEL + '&cursor=p2')).json() as { hasMore?: boolean; messages?: Array<{ ts?: string; text?: string }>; fetchedCount?: number };
        assert.equal(second.hasMore, false);
        assert.equal(second.messages?.some(message => message.text === 'early-page' && message.ts === '1700000000.000010'), true);
        assert.ok((second.fetchedCount ?? 0) >= 1);
    });
});

test('HIST-OAUTH: full local keeps provider error codes', async () => {
    for (const code of ['missing_scope', 'invalid_auth', 'ratelimited']) {
        await withHistoryServer({ isFullAccess: () => true, slackError: code }, async baseUrl => {
            const response = await fetch(baseUrl + '/api/slack/history?channel=' + CHANNEL + '&thread_ts=' + PARENT + '&limit=200');
            const body = await response.json() as { ok?: boolean; error?: string; code?: string; messages?: unknown };
            assert.equal(response.status, 502);
            assert.equal(body.ok, false);
            assert.equal(body.code, code);
            assert.notEqual(body.error, 'slack_turn_grant_required');
            assert.equal(body.messages, undefined);
        });
    }
});

test('AUTH-SAFE: omitted full keeps grant semantics', async t => {
    const destination = { channel: 'slack' as const, targetKind: 'channel' as const, peerKind: 'direct' as const, targetId: 'D1', threadId: '1.0' };
    assert.ok(reserveSlackToolGrant({ teamId: 'T1', actorId: 'U1', destination, credentialKey: slackCredentialKey(TOKEN) }, { requestId: 'safe-hist', scope: 'scope', chatSessionId: 'chat' }));
    const secret = activateSlackToolGrant('safe-hist', 'scope', 'chat');
    t.after(() => revokeSlackToolScope());
    await withHistoryServer({ isFullAccess: () => false }, async baseUrl => {
        const missing = await fetch(baseUrl + '/api/slack/history?channel=' + CHANNEL);
        assert.equal(missing.status, 401);
        const invalid = await fetch(baseUrl + '/api/slack/history?channel=' + CHANNEL, { headers: { 'x-jaw-slack-grant': 'not-a-grant' } });
        assert.equal(invalid.status, 401);
        const ok = await fetch(baseUrl + '/api/slack/history?channel=D1', { headers: { 'x-jaw-slack-grant': secret! } });
        assert.equal(ok.status, 200);
    });
});

test('AUTH-STALE-FULL vs Safe: invalid grant is ignored only under full', async () => {
    await withHistoryServer({ isFullAccess: () => true }, async baseUrl => {
        const response = await fetch(baseUrl + '/api/slack/history?channel=' + CHANNEL + '&thread_ts=' + PARENT, { headers: { 'x-jaw-slack-grant': 'not-a-grant' } });
        assert.equal(response.status, 200);
        const body = await response.json() as { fetchedCount?: number };
        assert.equal(body.fetchedCount, 192);
    });
    await withHistoryServer({ isFullAccess: () => false }, async (baseUrl, calls) => {
        const response = await fetch(baseUrl + '/api/slack/history?channel=' + CHANNEL, { headers: { 'x-jaw-slack-grant': 'not-a-grant' } });
        assert.equal(response.status, 401);
        const body = await response.json() as { error?: string; code?: string };
        assert.match(String(body.error ?? body.code ?? ''), /grant_invalid|slack_turn_grant_invalid/);
        assert.equal(calls.some(call => call.method.startsWith('conversations.')), false);
    });
});

test('AUTH-REMOTE: denied classifier does not admit headerless history', async () => {
    await withHistoryServer({ isFullAccess: () => false }, async (baseUrl, calls) => {
        const response = await fetch(baseUrl + '/api/slack/history?channel=' + CHANNEL);
        assert.equal(response.status, 401);
        assert.equal(calls.some(call => call.method.startsWith('conversations.')), false);
    });
});

test('HIST-TEXT: JSON keeps 192 while text format marks truncation', async () => {
    const long = replies(192).map((message, i) => ({ ...message, text: i === 0 ? 'early-root' : 'x'.repeat(80) + String(i) }));
    await withHistoryServer({
        isFullAccess: () => true,
        pages: { '': { ok: true, messages: long, has_more: false, response_metadata: { next_cursor: '' } } },
    }, async baseUrl => {
        const json = await (await fetch(baseUrl + '/api/slack/history?channel=' + CHANNEL + '&thread_ts=' + PARENT + '&limit=200')).json() as { fetchedCount?: number; messages?: unknown[] };
        assert.equal(json.fetchedCount, 192);
        assert.equal(json.messages?.length, 192);
        const text = await (await fetch(baseUrl + '/api/slack/history?channel=' + CHANNEL + '&thread_ts=' + PARENT + '&limit=200&format=text')).json() as { fetchedCount?: number; partial?: boolean; contentTruncated?: boolean; text?: string };
        assert.equal(text.fetchedCount, 192);
        assert.equal(text.partial, true);
        assert.equal(text.contentTruncated, true);
        assert.ok((text.text?.length ?? 0) <= 12000);
    });
});

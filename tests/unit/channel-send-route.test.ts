import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { registerMessagingRoutes } from '../../src/routes/messaging.ts';
import { registerSendTransport } from '../../src/messaging/send.ts';
import { settings } from '../../src/core/config.ts';
import { slackSendHandler } from '../../src/slack/send-handler.ts';

async function withMessagingServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
    const app = express();
    app.use(express.json());
    const passAuth = (_req: Request, _res: Response, next: NextFunction) => next();
    registerMessagingRoutes(app, passAuth, { validateSlackOperator: candidate => candidate === 'fixture-operator' });
    const server: Server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    try {
        await run(`http://127.0.0.1:${address.port}`);
    } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}

test('HTTP Slack blocks reach the real adapter and require persisted table proof', async () => {
    const savedFetch = globalThis.fetch;
    const savedSlack = settings.slack;
    settings.slack = { ...savedSlack, enabled: true, botToken: 'xoxb-fixture', channelIds: [] };
    registerSendTransport('slack', slackSendHandler);
    const table = { type: 'table', rows: [
        [{ type: 'raw_text', text: '항목' }, { type: 'raw_text', text: '수량' }],
        [{ type: 'raw_text', text: '위젯 A' }, { type: 'raw_number', value: 10 }],
    ] };
    const blocks = [
        { type: 'header', text: { type: 'plain_text', text: '방법 A' } },
        { type: 'markdown', text: '| 항목 | 수량 |\n| --- | --- |\n| 위젯 A | 10 |' },
        { type: 'divider' },
        { type: 'header', text: { type: 'plain_text', text: '방법 B' } },
        table,
    ];
    const posts: Record<string, unknown>[] = [];
    const reads: URLSearchParams[] = [];
    let mode: 'valid' | 'missing' | 'wrong_shape' | 'unavailable' = 'valid';
    globalThis.fetch = (async (url, init) => {
        if (!String(url).startsWith('https://slack.com/api/')) return savedFetch(url, init);
        if (String(url).endsWith('/chat.postMessage')) {
            posts.push(JSON.parse(String(init?.body)));
            return new Response(JSON.stringify({ ok: true, ts: `100.${posts.length}` }));
        }
        if (String(url).endsWith('/conversations.replies')) {
            const params = new URLSearchParams(String(init?.body));
            reads.push(params);
            if (mode === 'unavailable') return new Response(JSON.stringify({ ok: false, error: 'missing_scope' }));
            const stored = mode === 'missing' ? [{ type: 'rich_text', elements: [] }]
                : [{ ...table, rows: mode === 'wrong_shape' ? table.rows.slice(0, 1) : [table.rows[0], [table.rows[1]![0], posts.length === 2 ? { type: 'raw_number', value: 10, text: '10' } : { type: 'raw_text', text: '10' }]] }];
            return new Response(JSON.stringify({ ok: true, messages: [{ ts: params.get('oldest'), blocks: [{ type: 'header', text: { type: 'plain_text', text: '방법' } }, { type: 'divider' }, ...stored] }] }));
        }
        throw new Error(`Unexpected external request: ${url}`);
    }) as typeof fetch;
    try {
        await withMessagingServer(async baseUrl => {
            const request = {
                channel: 'slack', type: 'text', text: '표 전송 테스트', blocks,
                target: { channel: 'slack', targetKind: 'user', peerKind: 'direct', targetId: 'D_ROUTE', threadId: '99.1' },
            };
            const send = async (body: unknown) => {
                const response = await fetch(`${baseUrl}/api/channel/send`, {
                    method: 'POST', headers: { 'content-type': 'application/json', 'x-jaw-slack-operator': 'fixture-operator' }, body: JSON.stringify(body),
                });
                return { status: response.status, body: await response.json() };
            };
            const good = await send(request);
            assert.equal(good.status, 200);
            assert.equal(good.body.ok, true);
            const normalizedTable = { ...table, rows: [table.rows[0], [table.rows[1]![0], { type: 'raw_number', value: 10, text: '10' }]] };
            assert.deepEqual(posts.map(p => p['blocks']), [blocks.slice(0, 2), [...blocks.slice(2, 4), normalizedTable]]);
            assert.deepEqual(good.body.delivery, {
                verification: 'verified', expectedTables: 2, verifiedTables: 2,
                tableContent: 'verified', richContent: 'not_checked', sourceAccuracy: 'not_checked', comparisonVersion: 1,
                channelId: 'D_ROUTE', messageTs: ['100.1', '100.2'],
                expectedFeatures: ['divider', 'heading'], verifiedFeatures: ['divider', 'heading'],
            });
            assert.ok(posts.every(p => p['thread_ts'] === '99.1'));
            assert.equal(reads.length, 2);
            assert.ok(reads.every(p => p.get('ts') === '99.1' && p.get('channel') === 'D_ROUTE'));

            for (const failureMode of ['missing', 'wrong_shape', 'unavailable'] as const) {
                mode = failureMode;
                const before = posts.length;
                const failed = await send(request);
                assert.equal(failed.status, 502);
                assert.equal(failed.body.ok, false);
                assert.equal(failed.body.sent, true);
                assert.equal(failed.body.retryable, false);
                assert.match(failed.body.error, /slack_table_verification_failed/);
                assert.equal(failed.body.delivery.verification, 'failed');
                assert.equal(posts.length, before + 1, 'readback failure must stop; never repost or send remaining tables');
            }
            const before = posts.length;
            for (const invalid of [
                { ...request, blocks: '{}' }, { ...request, blocks: [] },
                { ...request, blocks: [{ text: 'missing type' }] },
                { ...request, blocks: [{ type: 'table', rows: Array(101).fill(table.rows[0]) }] },
                { ...request, blocks: [{ type: 'table', rows: [Array(21).fill({ type: 'raw_text', text: 'x' })] }] },
                { ...request, blocks: [{ type: 'table', rows: [[{ type: 'raw_text', text: 'x'.repeat(10001) }]] }] },
                { ...request, blocks: [{ type: 'table', rows: [[{ type: 'raw_number', value: '10' }]] }] },
                { ...request, type: 'keyboard' },
                { ...request, channel: 'discord', target: { ...request.target, channel: 'discord' } },
            ]) {
                assert.equal((await send(invalid)).status, 400);
            }
            assert.equal(posts.length, before, 'invalid blocks must fail before vendor calls');
        });
    } finally {
        globalThis.fetch = savedFetch;
        settings.slack = savedSlack;
    }
});

test('POST /api/channel/send returns the stable invalid_channel envelope with an actionable Slack hint', async () => {
    await withMessagingServer(async baseUrl => {
        const response = await fetch(`${baseUrl}/api/channel/send`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-jaw-slack-operator': 'fixture-operator' },
            body: JSON.stringify({ channel: 'C123ABC', type: 'text', text: 'hello' }),
        });
        const body = await response.json() as { error?: string; code?: string };

        assert.equal(response.status, 400);
        assert.equal(body.code, 'invalid_channel');
        assert.match(body.error ?? '', /channel is (?:a )?transport/i);
        assert.match(body.error ?? '', /chat_id|target\.targetId/);
        assert.doesNotMatch(body.error ?? '', /xox[baprs]-|C123ABC|lastActive|latestSeen/);
    });
});
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The guard refuses correctly; the question is whether the refusal survives the
// route intact. `forbidden()` grew a `code` and a `detail`, and getting that
// object shape wrong turns a 403 into a 500 — the top regression this guards
// (#404). The unit tests cover the guard; only this covers the chain
// forbidden → httpDetail → response JSON.
test('POST /api/channel/send refuses a path outside the roots with a 403 that says where they are', async () => {
    const previousCliHome = process.env.CLI_JAW_HOME;
    const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-send-route-home-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-send-route-outside-'));
    const filePath = path.join(outside, 'report.png');
    try {
        process.env.CLI_JAW_HOME = testHome;
        // The file must exist: a missing one is refused earlier, as
        // path_not_resolvable, and would not exercise this branch at all.
        fs.writeFileSync(filePath, 'x');

        await withMessagingServer(async baseUrl => {
            const response = await fetch(`${baseUrl}/api/channel/send`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-jaw-slack-operator': 'fixture-operator' },
                body: JSON.stringify({
                    channel: 'slack', type: 'photo', filePath,
                    target: { channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'C_ROUTE' },
                }),
            });
            const body = await response.json() as { code?: string; detail?: { allowedRoots?: string[] } };

            assert.equal(response.status, 403, 'a refused path must not surface as a 500');
            assert.equal(body.code, 'path_not_allowed');
            const roots = body.detail?.allowedRoots;
            assert.ok(Array.isArray(roots) && roots.length > 0, `the response must name the roots; saw ${JSON.stringify(body)}`);
            assert.ok(
                roots.includes(fs.realpathSync(testHome)),
                `JAW_HOME must be among them; saw ${JSON.stringify(roots)}`,
            );
        });
    } finally {
        if (previousCliHome == null) delete process.env.CLI_JAW_HOME;
        else process.env.CLI_JAW_HOME = previousCliHome;
        fs.rmSync(testHome, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

// The other half of the guard: a path INSIDE the roots must still go through.
// Every test above asserts a refusal, so a change that refused everything would
// have left them all green (#404).
test('a path inside the allowed roots still reaches the transport', async () => {
    const previousCliHome = process.env.CLI_JAW_HOME;
    const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-send-ok-home-'));
    try {
        process.env.CLI_JAW_HOME = testHome;
        const uploads = path.join(testHome, 'uploads');
        fs.mkdirSync(uploads, { recursive: true });
        const filePath = path.join(uploads, 'report.png');
        fs.writeFileSync(filePath, 'x');

        const { registerSendTransport } = await import('../../src/messaging/send.ts');
        const { settings } = await import('../../src/core/config.ts');
        // The path guard is not the only gate: the target allowlist runs after
        // it. Configure the channel so a pass here means the FILE was accepted,
        // not that some later check happened to let it through.
        const previousSlack = settings.slack;
        settings.slack = { ...(settings.slack || {}), enabled: true, botToken: 'xoxb-fixture', channelIds: ['C_OK'] };
        const seen: Array<Record<string, unknown>> = [];
        registerSendTransport('slack', async req => {
            seen.push(req as unknown as Record<string, unknown>);
            return { ok: true };
        });

        try {
            await withMessagingServer(async baseUrl => {
            const response = await fetch(`${baseUrl}/api/channel/send`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-jaw-slack-operator': 'fixture-operator' },
                body: JSON.stringify({
                    channel: 'slack', type: 'photo', filePath,
                    target: { channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'C_OK' },
                }),
            });
            assert.equal(response.status, 200, `an allowed path must not be refused: ${await response.text()}`);
            assert.equal(seen.length, 1, 'the transport must actually receive it');
            });
        } finally {
            settings.slack = previousSlack;
        }
    } finally {
        if (previousCliHome == null) delete process.env.CLI_JAW_HOME;
        else process.env.CLI_JAW_HOME = previousCliHome;
        fs.rmSync(testHome, { recursive: true, force: true });
    }
});

// The same guard sits behind the send routes, and each builds its own error
// response. Covering only /api/channel/send would leave the copies free to
// drift back to a bare 500 (#404).
//
// /api/telegram/send is not here: it requires a configured client and answers
// 503 before the guard runs, so it cannot reach this branch without standing up
// a Telegram transport. Its error shape is the same expression as the others.
test('every send route surfaces a refused path the same way', async () => {
    const previousCliHome = process.env.CLI_JAW_HOME;
    const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-send-routes-home-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-send-routes-outside-'));
    const filePath = path.join(outside, 'report.png');
    try {
        process.env.CLI_JAW_HOME = testHome;
        fs.writeFileSync(filePath, 'x');

        await withMessagingServer(async baseUrl => {
            for (const [route, body] of [
                ['/api/slack/send', {
                    type: 'photo', filePath,
                    target: { channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'C_ROUTE' },
                }],
                ['/api/discord/send', {
                    type: 'photo', filePath,
                    target: { channel: 'discord', targetKind: 'channel', peerKind: 'channel', targetId: '123' },
                }],
            ] as const) {
                const response = await fetch(`${baseUrl}${route}`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'x-jaw-slack-operator': 'fixture-operator' },
                    body: JSON.stringify(body),
                });
                const json = await response.json() as { code?: string; detail?: { allowedRoots?: string[] } };

                assert.equal(response.status, 403, `${route} must refuse with 403, not 500`);
                assert.equal(json.code, 'path_not_allowed', `${route} must name the refusal`);
                assert.ok(
                    Array.isArray(json.detail?.allowedRoots) && json.detail!.allowedRoots!.length > 0,
                    `${route} must say where the roots are; saw ${JSON.stringify(json)}`,
                );
            }
        });
    } finally {
        if (previousCliHome == null) delete process.env.CLI_JAW_HOME;
        else process.env.CLI_JAW_HOME = previousCliHome;
        fs.rmSync(testHome, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

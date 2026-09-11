import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { registerMessagingRoutes } from '../../src/routes/messaging.ts';
import { registerSendTransport } from '../../src/messaging/send.ts';
import { settings } from '../../src/core/config.ts';
import { slackSendHandler } from '../../src/slack/send-handler.ts';
import { encodeTurnConversation } from '../../src/messaging/turn-conversation.ts';
import { setLastActiveTarget, clearTargetState } from '../../src/messaging/runtime.ts';
import { getTelegramSendClient, invalidateTelegramSendClient } from '../../src/telegram/bot.ts';
import { reserveSlackToolGrant, activateSlackToolGrant, revokeSlackToolScope, slackCredentialKey } from '../../src/slack/tool-context.ts';

type MessagingOptions = Parameters<typeof registerMessagingRoutes>[2] & {
    isFullAccess?: (req: Request) => boolean;
};
async function withMessagingServer(run: (baseUrl: string) => Promise<void>, options: MessagingOptions = {}): Promise<void> {
    const app = express();
    app.use(express.json());
    const passAuth = (_req: Request, _res: Response, next: NextFunction) => next();
    registerMessagingRoutes(app, passAuth, { validateSlackOperator: candidate => candidate === 'fixture-operator', ...options } as MessagingOptions);
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
            // Every chunk posts before any readback, so the stored message is keyed
            // by the requested ts: 100.1 carried the markdown table (text cell),
            // 100.2 the native table (number cell).
            const cell = params.get('oldest') === '100.1'
                ? { type: 'raw_text', text: '10' } : { type: 'raw_number', value: 10, text: '10' };
            const stored = mode === 'missing' ? [{ type: 'rich_text', elements: [] }]
                : [{ ...table, rows: mode === 'wrong_shape' ? table.rows.slice(0, 1) : [table.rows[0], [table.rows[1]![0], cell]] }];
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
                channelId: 'D_ROUTE', messageTs: ['100.1', '100.2'], postedChunks: 2, totalChunks: 2,
                messages: [0, 1].map(index => ({ index, ts: `100.${index + 1}`, verification: 'verified',
                    expectedTables: 1, verifiedTables: 1, tableContent: 'verified',
                    expectedFeatures: index ? ['divider', 'heading'] : ['heading'],
                    verifiedFeatures: index ? ['divider', 'heading'] : ['heading'],
                    richContent: 'not_checked', sourceAccuracy: 'not_checked' })),
                expectedFeatures: ['divider', 'heading'], verifiedFeatures: ['divider', 'heading'],
            });
            assert.ok(posts.every(p => p['thread_ts'] === '99.1'));
            assert.equal(reads.length, 2);
            assert.ok(reads.every(p => p.get('ts') === '99.1' && p.get('channel') === 'D_ROUTE'));

            for (const failureMode of ['missing', 'wrong_shape', 'unavailable'] as const) {
                mode = failureMode;
                const before = posts.length;
                const failed = await send(request);
                assert.equal(failed.status, 200);
                assert.equal(failed.body.ok, true);
                assert.equal(failed.body.sent, true);
                assert.equal(failed.body.retryable, false);
                const status = mode === 'unavailable' ? 'unavailable' : 'failed';
                assert.equal(failed.body.delivery.verification, status);
                assert.equal(failed.body.delivery.tableContent, status);
                assert.equal(failed.body.delivery.verifiedTables, 0);
                assert.equal(failed.body.delivery.messages.length, 2);
                for (const message of failed.body.delivery.messages) {
                    assert.equal(message.verification, status);
                    assert.equal(message.error, mode === 'unavailable' ? 'missing_scope' : 'table_count_or_shape_mismatch');
                }
                assert.equal(posts.length, before + 2, 'readback failure must not truncate or repost');
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


test('full-local send: all four aliases lift explicit dest/root and refuse missing address', async t => {
    const previousCliHome = process.env.CLI_JAW_HOME;
    const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-full-send-home-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-full-send-out-'));
    const filePath = path.join(outside, 'report.png');
    fs.writeFileSync(filePath, 'x');
    process.env.CLI_JAW_HOME = testHome;
    const prevSlack = settings.slack;
    const prevTelegram = settings.telegram;
    const prevDiscord = settings.discord;
    const prevMessaging = settings.messaging;
    settings.slack = { ...prevSlack, enabled: true, botToken: 'xoxb-full-send', channelIds: ['CALLOW'] };
    settings.discord = { ...prevDiscord, enabled: true, channelIds: ['111'] };
    settings.telegram = { ...prevTelegram, enabled: true, token: '123456:ABC-FULLSEND', allowedChatIds: [111] };
    settings.messaging = { ...prevMessaging, homeChannel: 'slack', enabledChannels: ['slack', 'telegram', 'discord'] };
    invalidateTelegramSendClient();
    const tg = getTelegramSendClient().client;
    assert.ok(tg);
    const tgCalls: Array<string | number> = [];
    (tg.api as { sendMessage: typeof tg.api.sendMessage }).sendMessage = (async (chatId: string | number) => {
        tgCalls.push(chatId);
        return { ok: true, message_id: 1 };
    }) as typeof tg.api.sendMessage;
    const seen: Array<{ route?: string; channel?: string; targetId?: string; threadId?: string; filePath?: string }> = [];
    registerSendTransport('slack', async req => { seen.push({
        channel: 'slack', targetId: req.target?.targetId, threadId: req.target?.threadId, filePath: req.filePath,
    }); return { ok: true }; });
    registerSendTransport('discord', async req => { seen.push({ channel: 'discord', targetId: req.target?.targetId, filePath: req.filePath }); return { ok: true }; });
    registerSendTransport('telegram', async req => { seen.push({ channel: 'telegram', targetId: req.target?.targetId, filePath: req.filePath }); return { ok: true }; });
    setLastActiveTarget('slack', { channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'CLAST' });
    t.after(() => {
        if (previousCliHome == null) delete process.env.CLI_JAW_HOME;
        else process.env.CLI_JAW_HOME = previousCliHome;
        settings.slack = prevSlack;
        settings.telegram = prevTelegram;
        settings.discord = prevDiscord;
        settings.messaging = prevMessaging;
        clearTargetState();
        invalidateTelegramSendClient();
        revokeSlackToolScope();
        fs.rmSync(testHome, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    });

    await withMessagingServer(async baseUrl => {
        const json = async (route: string, body: unknown, extra: Record<string, string> = {}) => {
            const response = await fetch(baseUrl + route, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...extra },
                body: JSON.stringify(body),
            });
            return { status: response.status, body: await response.json() as Record<string, unknown> };
        };

        seen.length = 0;
        const slackFile = await json('/api/slack/send', {
            type: 'photo', filePath,
            target: { channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'CUNLISTED' },
        });
        assert.equal(slackFile.status, 200, JSON.stringify(slackFile.body));
        assert.equal(seen.at(-1)?.targetId, 'CUNLISTED');
        assert.ok(seen.at(-1)?.filePath);

        seen.length = 0;
        const discordFile = await json('/api/discord/send', {
            type: 'photo', filePath,
            target: { channel: 'discord', targetKind: 'channel', peerKind: 'channel', targetId: '888001' },
        });
        assert.equal(discordFile.status, 200, JSON.stringify(discordFile.body));
        assert.equal(seen.at(-1)?.targetId, '888001');

        seen.length = 0;
        const channelFile = await json('/api/channel/send', {
            channel: 'slack', type: 'photo', filePath,
            target: { channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'CUNLISTED' },
        });
        assert.equal(channelFile.status, 200, JSON.stringify(channelFile.body));
        assert.equal(seen.at(-1)?.targetId, 'CUNLISTED');

        tgCalls.length = 0;
        const telegramOk = await json('/api/telegram/send', { type: 'text', text: 'hello', chat_id: 999001 });
        assert.equal(telegramOk.status, 200, JSON.stringify(telegramOk.body));
        assert.equal(String(tgCalls.at(-1)), '999001');

        seen.length = 0;
        const missing = await json('/api/channel/send', { channel: 'slack', type: 'text', text: 'no dest' });
        assert.equal(missing.status, 400);
        assert.equal(missing.body.code, 'full_access_destination_required');
        assert.equal(seen.length, 0);

        const telegramMissing = await json('/api/telegram/send', { type: 'text', text: 'no dest' });
        assert.equal(telegramMissing.status, 400);
        assert.equal(telegramMissing.body.code, 'full_access_destination_required');

        const discordMissing = await json('/api/discord/send', { type: 'text', text: 'no dest' });
        assert.equal(discordMissing.status, 400);
        assert.equal(discordMissing.body.code, 'full_access_destination_required');

        const turn = encodeTurnConversation({ channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'CTURN' });
        seen.length = 0;
        const viaTurn = await json('/api/channel/send', { channel: 'slack', type: 'text', text: 'echo', turn_conversation: turn });
        assert.equal(viaTurn.status, 200, JSON.stringify(viaTurn.body));
        assert.equal(seen.at(-1)?.targetId, 'CTURN');

        const cross = encodeTurnConversation({ channel: 'discord', targetKind: 'channel', peerKind: 'channel', targetId: '888001' });
        const crossSend = await json('/api/channel/send', { channel: 'slack', type: 'text', text: 'echo', turn_conversation: cross });
        assert.equal(crossSend.status, 400);
        assert.equal(crossSend.body.code, 'full_access_destination_required');

        const dest = { channel: 'slack' as const, targetKind: 'channel' as const, peerKind: 'direct' as const, targetId: 'DGRANT1', threadId: '1.0' };
        assert.ok(reserveSlackToolGrant({ teamId: 'T1', actorId: 'U1', destination: dest, credentialKey: slackCredentialKey('xoxb-full-send') },
            { requestId: 'send-grant', scope: 'scope', chatSessionId: 'chat' }));
        const secret = activateSlackToolGrant('send-grant', 'scope', 'chat')!;
        seen.length = 0;
        const grantOnly = await json('/api/channel/send', { channel: 'slack', type: 'text', text: 'from grant' }, { 'x-jaw-slack-grant': secret });
        assert.equal(grantOnly.status, 400);
        assert.equal(grantOnly.body.code, 'full_access_destination_required');
        assert.equal(seen.some(item => item.targetId === 'DGRANT1'), false);
        seen.length = 0;
        const grantPlus = await json('/api/channel/send', {
            channel: 'slack', type: 'text', text: 'explicit',
            target: { channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'CUNLISTED' },
        }, { 'x-jaw-slack-grant': secret });
        assert.equal(grantPlus.status, 200, JSON.stringify(grantPlus.body));
        assert.equal(seen.at(-1)?.targetId, 'CUNLISTED');

        const scheduledDest = {
            channel: 'slack' as const,
            targetKind: 'channel' as const,
            peerKind: 'channel' as const,
            targetId: 'CHEARTBEAT',
            threadId: '2.0',
        };
        assert.ok(reserveSlackToolGrant({
            teamId: 'T1',
            actorId: 'U1',
            destination: scheduledDest,
            credentialKey: slackCredentialKey('xoxb-full-send'),
            enforceDestination: true,
        }, { requestId: 'heartbeat-grant', scope: 'heartbeat', chatSessionId: 'default' }));
        const scheduledSecret = activateSlackToolGrant('heartbeat-grant', 'heartbeat', 'default')!;

        seen.length = 0;
        const nativeHeaderless = await json('/api/channel/send', {
            channel: 'slack', type: 'text', text: 'native escape',
            target: { ...scheduledDest, targetId: 'COTHER' },
        });
        assert.equal(nativeHeaderless.status, 409);
        assert.equal(nativeHeaderless.body.code, 'slack_enforced_destination_grant_required');
        assert.equal(seen.length, 0, 'headerless native/employee calls cannot choose a target during scheduled work');

        const scheduledOmit = await json('/api/channel/send', {
            channel: 'slack', type: 'text', text: 'scheduled',
        }, { 'x-jaw-slack-grant': scheduledSecret });
        assert.equal(scheduledOmit.status, 200, JSON.stringify(scheduledOmit.body));
        assert.equal(seen.at(-1)?.targetId, scheduledDest.targetId);
        assert.equal(seen.at(-1)?.threadId, scheduledDest.threadId,
            'server-owned grant supplies its destination even under full-local Auto');

        const scheduledWrong = await json('/api/channel/send', {
            channel: 'slack', type: 'text', text: 'wrong',
            target: { ...scheduledDest, targetId: 'DOTHER' },
        }, { 'x-jaw-slack-grant': scheduledSecret });
        assert.equal(scheduledWrong.status, 403);
        assert.equal(scheduledWrong.body.code, 'slack_destination_mismatch');
    }, { isFullAccess: () => true });

    await withMessagingServer(async baseUrl => {
        const response = await fetch(baseUrl + '/api/channel/send', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                channel: 'slack', type: 'photo', filePath, fullAccess: true,
                target: { channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'CUNLISTED' },
            }),
        });
        const body = await response.json() as { code?: string };
        assert.equal(response.status, 403);
        assert.equal(body.code, 'path_not_allowed');
    });
});


test('full-local send rejects malformed chat_id and target before echo or coercion', async t => {
    const seen: string[] = [];
    registerSendTransport('slack', async req => { seen.push(req.target?.targetId ?? ''); return { ok: true }; });
    registerSendTransport('discord', async req => { seen.push(req.target?.targetId ?? ''); return { ok: true }; });
    registerSendTransport('telegram', async req => { seen.push(req.target?.targetId ?? ''); return { ok: true }; });
    const prevSlack = settings.slack;
    const prevTelegram = settings.telegram;
    const prevMessaging = settings.messaging;
    settings.slack = { ...prevSlack, enabled: true, botToken: 'xoxb-full-shape', channelIds: ['CALLOW'] };
    settings.telegram = { ...prevTelegram, enabled: true, token: '123456:ABC-SHAPE', allowedChatIds: [123] };
    settings.messaging = { ...prevMessaging, homeChannel: 'slack', enabledChannels: ['slack', 'telegram', 'discord'] };
    invalidateTelegramSendClient();
    const tg = getTelegramSendClient().client;
    assert.ok(tg);
    const tgCalls: Array<string | number> = [];
    (tg.api as { sendMessage: typeof tg.api.sendMessage }).sendMessage = (async (chatId: string | number) => {
        tgCalls.push(chatId);
        return { ok: true, message_id: 1 };
    }) as typeof tg.api.sendMessage;
    setLastActiveTarget('slack', { channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'CLAST' });
    t.after(() => {
        settings.slack = prevSlack;
        settings.telegram = prevTelegram;
        settings.messaging = prevMessaging;
        clearTargetState();
        invalidateTelegramSendClient();
    });
    const echo = encodeTurnConversation({ channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'CTURN' });
    await withMessagingServer(async baseUrl => {
        const json = async (route: string, body: unknown) => {
            const response = await fetch(baseUrl + route, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
            });
            return { status: response.status, body: await response.json() as Record<string, unknown> };
        };
        for (const chatId of [[123], { id: 123 }, false] as const) {
            seen.length = 0; tgCalls.length = 0;
            const channelSend = await json('/api/channel/send', { channel: 'slack', type: 'text', text: 'nope', chat_id: chatId, turn_conversation: echo });
            assert.equal(channelSend.status, 400, JSON.stringify({ chatId, channelSend }));
            assert.equal(channelSend.body.error, 'invalid_chat_id');
            assert.equal(seen.length, 0);
            const telegramSend = await json('/api/telegram/send', { type: 'text', text: 'nope', chat_id: chatId });
            assert.equal(telegramSend.status, 400, JSON.stringify({ chatId, telegramSend }));
            assert.equal(telegramSend.body.error, 'invalid_chat_id');
            assert.equal(tgCalls.length, 0);
        }
        seen.length = 0;
        const emptyTarget = await json('/api/channel/send', { channel: 'slack', type: 'text', text: 'nope', target: '', turn_conversation: echo });
        assert.equal(emptyTarget.status, 400);
        assert.equal(emptyTarget.body.error, 'invalid_outbound_target');
        assert.equal(seen.length, 0);
        const objectTarget = await json('/api/channel/send', { channel: 'slack', type: 'text', text: 'nope', target: { id: 'CTURN' }, turn_conversation: echo });
        assert.equal(objectTarget.status, 400);
        assert.ok(['invalid_outbound_target', 'channel_target_mismatch'].includes(String(objectTarget.body.error ?? objectTarget.body.code)), JSON.stringify(objectTarget.body));
        assert.equal(seen.length, 0);
        seen.length = 0;
        const validNumber = await json('/api/telegram/send', { type: 'text', text: 'ok', chat_id: 999001 });
        assert.equal(validNumber.status, 200, JSON.stringify(validNumber.body));
        assert.equal(String(tgCalls.at(-1)), '999001');
        seen.length = 0;
        const validString = await json('/api/channel/send', {
            channel: 'slack', type: 'text', text: 'ok',
            target: { channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'CUNLISTED' },
        });
        assert.equal(validString.status, 200, JSON.stringify(validString.body));
        assert.equal(seen.at(-1), 'CUNLISTED');
    }, { isFullAccess: () => true });

    seen.length = 0;
    await withMessagingServer(async baseUrl => {
        const response = await fetch(baseUrl + '/api/channel/send', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-jaw-slack-operator': 'fixture-operator' },
            body: JSON.stringify({ channel: 'slack', type: 'text', text: 'coerced', chat_id: [123] }),
        });
        assert.notEqual((await response.json() as { error?: string }).error, 'invalid_chat_id');
    });
});

test('post-dispatch grant cancellation preserves unknown file delivery', async () => {
    const savedFetch = globalThis.fetch, savedSlack = settings.slack;
    const token = 'xoxb-cancel-unknown';
    settings.slack = { ...savedSlack, enabled: true, botToken: token, channelIds: ['CUNKNOWN'] };
    const destination = { channel: 'slack' as const, targetKind: 'channel' as const, peerKind: 'channel' as const, targetId: 'CUNKNOWN' };
    assert.ok(reserveSlackToolGrant({ teamId: 'T1', actorId: 'U1', destination, credentialKey: slackCredentialKey(token) },
        { requestId: 'file-unknown', scope: 'file-unknown-scope', chatSessionId: 'file-chat' }));
    const secret = activateSlackToolGrant('file-unknown', 'file-unknown-scope', 'file-chat')!;
    globalThis.fetch = async (url, init) => {
        if (!String(url).startsWith('https://slack.com/api/')) return savedFetch(url, init);
        const method = String(url).split('/').at(-1);
        if (method === 'auth.test') return new Response(JSON.stringify({ ok: true, team_id: 'T1', user_id: 'UBOT' }));
        if (method === 'conversations.info') return new Response(JSON.stringify({ ok: true, channel: { id: 'CUNKNOWN', is_shared: false, is_ext_shared: false, context_team_id: 'T1' } }));
        return new Response(JSON.stringify({ ok: true, members: ['U1', 'UBOT'], response_metadata: { next_cursor: '' } }));
    };
    registerSendTransport('slack', async () => {
        revokeSlackToolScope('file-unknown-scope');
        return { ok: false, sent: 'unknown', retryable: false, upload: { fileId: 'FUNKNOWN', stage: 'completion', state: 'unknown' } };
    });
    try {
        await withMessagingServer(async base => {
            const response = await fetch(base + '/api/channel/send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-jaw-slack-grant': secret },
                body: JSON.stringify({ channel: 'slack', type: 'text', text: 'fixture', target: destination }) });
            const body = await response.json() as { sent?: unknown; error?: string; upload?: { fileId?: string } };
            assert.equal(response.status, 409, JSON.stringify(body)); assert.equal(body.sent, 'unknown');
            assert.equal(body.error, 'slack_grant_cancelled_after_dispatch'); assert.equal(body.upload?.fileId, 'FUNKNOWN');
        });
    } finally { globalThis.fetch = savedFetch; settings.slack = savedSlack; registerSendTransport('slack', slackSendHandler); revokeSlackToolScope('file-unknown-scope'); }
});

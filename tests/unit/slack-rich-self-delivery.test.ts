import '../setup/isolated-home.ts';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { settings } from '../../src/core/config.ts';
import { trackedSelfDeliveries, resetTurnDeliveryState } from '../../src/messaging/turn-delivery.ts';

let collect: () => Promise<{ text: string; data: object }>;
let relayed: () => void;
mock.module('../../src/orchestrator/collect.ts', {
    namedExports: { orchestrateAndCollectData: () => collect(), orchestrateAndCollect: async () => { throw new Error('unexpected Telegram collection'); } },
});
mock.module('../../src/slack/progress.ts', {
    namedExports: { startSlackProgress: async () => null, statusFromToolEvent: () => null },
});
mock.module('../../src/slack/forwarder.ts', {
    namedExports: { createSlackForwarder: () => () => {}, relaySlackImages: async () => relayed() },
});
const { processSlackMessageEvent } = await import('../../src/slack/bot.ts');
const { registerMessagingRoutes } = await import('../../src/routes/messaging.ts');
const { registerSendTransport } = await import('../../src/messaging/send.ts');
const { slackSendHandler } = await import('../../src/slack/send-handler.ts');

for (const mode of ['unavailable', 'failed'] as const) {
    test(`HTTP self-send with ${mode} verification is consumed by the existing bot dispatch dedupe`, { timeout: 10000 }, async () => {
        const savedFetch = globalThis.fetch;
        const savedSlack = settings.slack;
        const savedMultiSession = structuredClone(settings.multiSession);
        const destination = { channel: 'slack', targetId: `C_RICH_${mode}`, targetKind: 'channel', peerKind: 'channel' } as const;
        const answer = '| H |\n|---|\n| A &amp; B |';
        let posts = 0; let reads = 0;
        let replyCompleted!: () => void;
        const completed = new Promise<void>(resolve => { replyCompleted = resolve; });
        relayed = replyCompleted;
        settings.slack = { ...savedSlack, enabled: true, botToken: 'xoxb-fixture', channelIds: [destination.targetId] };
        settings.multiSession.enabled = true;
        settings.multiSession.channels.slack = true;
        resetTurnDeliveryState();
        registerSendTransport('slack', slackSendHandler);
        globalThis.fetch = async (url, init) => {
            if (String(url).startsWith('http://127.0.0.1:')) return savedFetch(url, init);
            if (String(url).endsWith('/chat.postMessage')) {
                posts++;
                return new Response(JSON.stringify({ ok: true, ts: '4.1' }));
            }
            if (String(url).endsWith('/conversations.history')) {
                reads++;
                return new Response(JSON.stringify(mode === 'unavailable' ? { ok: false, error: 'missing_scope' }
                    : { ok: true, messages: [{ ts: '4.1', blocks: [{ type: 'table', rows: [
                        [{ type: 'raw_text', text: 'H' }], [{ type: 'raw_text', text: 'wrong' }],
                    ] }] }] }));
            }
            // Identity/conversation probes stay fake; no Slack connection is opened.
            return new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }));
        };
        const app = express();
        app.use(express.json());
        registerMessagingRoutes(app, (_req, _res, next) => next());
        const server = createServer(app);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        let apiResult: { ok: boolean; delivery: import('../../src/slack/send-only-client.ts').SlackDeliveryReceipt } | undefined;
        let claimsAfterSelfSend = 0;
        collect = async () => {
            const response = await fetch(`http://127.0.0.1:${address.port}/api/channel/send`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ channel: 'slack', type: 'text', text: answer, target: destination }),
            });
            apiResult = await response.json();
            claimsAfterSelfSend = trackedSelfDeliveries();
            return { text: answer, data: {} };
        };
        try {
            await processSlackMessageEvent({ channel: destination.targetId, user: 'U_FIXTURE', ts: '3.1' } as never,
                destination, 'reply with a table', new AbortController().signal);
            await completed;
            assert.ok(apiResult);
            assert.equal(apiResult.ok, true);
            assert.equal(apiResult.delivery.verification, mode);
            assert.equal(apiResult.delivery.tableContent, mode);
            assert.equal(apiResult.delivery.messages[0].error, mode === 'unavailable' ? 'missing_scope' : 'table_content_mismatch:0:1:0');
            assert.equal(claimsAfterSelfSend, 1, 'real HTTP route records the transport success');
            assert.equal(trackedSelfDeliveries(), 0, 'real bot dispatch consumes the claim');
            assert.equal(posts, 1, 'dispatch must not post the already delivered answer again');
            assert.equal(reads, 1);
        } finally {
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
            globalThis.fetch = savedFetch;
            settings.slack = savedSlack;
            settings.multiSession = savedMultiSession;
            resetTurnDeliveryState();
        }
    });
}

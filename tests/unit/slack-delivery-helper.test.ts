import '../setup/isolated-home.ts';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../../src/core/config.ts';
import { broadcast } from '../../src/core/bus.ts';
import { log } from '../../src/core/logger.ts';
import { redactChannelSecrets } from '../../src/messaging/redact.ts';

// Drive the real Slack bot producers. Collection, gateway admission, ACK,
// progress, identity and the outbound Slack transports are faked; no socket,
// SDK client or live message request is started.
const operations: string[] = [];
let completion: Record<string, unknown> = {};
let body = 'answer';
let queued = false;
let id = 0;
let activeRequest = '';
let sendCalls = 0;

function assertSlackBodyOrder(events: string[], text: string, outcome = 'success') {
    const ackLabel = `ack:${outcome}`;
    const labels = [`post:slack:${text}`, ackLabel, 'progress:finish', 'images:slack'];
    for (const label of labels) assert.equal(events.filter(value => value === label).length, 1, `${label}: ${JSON.stringify(events)}`);
    assert.ok(events.indexOf(labels[0]!) < events.indexOf(ackLabel), 'body precedes reaction ACK');
    assert.ok(events.indexOf(ackLabel) < events.indexOf('progress:finish'), 'ACK precedes bounded status cleanup');
    assert.ok(events.indexOf('progress:finish') < events.indexOf('images:slack'), 'status settles before optional image relay');
}

function deliverySpine(events: string[], text: string) {
    const labels = new Set([`post:slack:${text}`, 'ack:success', 'progress:finish', 'images:slack']);
    return events.filter(value => labels.has(value));
}

type SlackSendOpts = {
    requireBodyDelivery?: boolean;
    onPosted?: (info: { ts?: string; messageTs: string[]; postedChunks: number; totalChunks: number }) => void | Promise<void>;
};

async function defaultSend(_token: string, _target: unknown, text: string, opts?: SlackSendOpts) {
    sendCalls += 1;
    operations.push(`post:slack:${text}`);
    await opts?.onPosted?.({ ts: 'notice-ts', messageTs: ['notice-ts'], postedChunks: 1, totalChunks: 1 });
    return { ok: true, ts: 'notice-ts' };
}

let sendSlackTextImpl: typeof defaultSend = defaultSend;

mock.module('../../src/orchestrator/collect.ts', { namedExports: {
    orchestrateAndCollect: async () => { throw new Error('Producer dropped native metadata'); },
    orchestrateAndCollectData: async () => ({ text: body, data: completion }),
} });
mock.module('../../src/orchestrator/gateway.ts', { namedExports: {
    submitMessage: () => ({
        action: queued ? 'queued' : 'started',
        disposition: queued ? 'queued' : 'new_run',
        pending: 1,
        requestId: activeRequest,
        sessionContext: { scope: 'default', chatSessionId: 'default' },
    }),
} });
const ack = await import('../../src/messaging/ack-reaction.ts');
mock.module('../../src/messaging/ack-reaction.ts', { namedExports: { ...ack,
    shouldAck: () => true,
    createAckHandle: () => ({
        to: async () => { operations.push('ack:running'); },
        settle: async (outcome: string) => { operations.push(`ack:${outcome}`); },
    }),
} });
const delivery = await import('../../src/messaging/turn-delivery.ts');
mock.module('../../src/messaging/turn-delivery.ts', { namedExports: { ...delivery, wasSelfDelivered: () => false } });
const slackSend = await import('../../src/slack/send-only-client.ts');
mock.module('../../src/slack/send-only-client.ts', { namedExports: { ...slackSend,
    getSlackSendClient: () => ({ token: 'fake' }),
    sendSlackText: (_token: string, target: unknown, text: string, opts?: SlackSendOpts) => sendSlackTextImpl(_token, target, text, opts),
} });
const slackForwarder = await import('../../src/slack/forwarder.ts');
mock.module('../../src/slack/forwarder.ts', { namedExports: { ...slackForwarder,
    relaySlackImages: async () => { operations.push('images:slack'); },
} });
const identity = await import('../../src/slack/identity.ts');
mock.module('../../src/slack/identity.ts', { namedExports: { ...identity,
    resolveSenderIdentity: async () => ({ id: 'U1', name: 'User', kind: 'user' }),
    buildSenderPrompt: (_identity: unknown, text: string) => text,
    buildSenderDisplay: (_identity: unknown, text: string) => text,
} });
mock.module('../../src/slack/progress.ts', { namedExports: {
    startSlackProgress: async () => {
        let finished = false;
        return {
            update() {}, tool() {}, projectedTool() {}, phase() {},
            finish: async (_outcome = 'complete', _options: { bodyDelivered?: boolean } = {}) => {
                if (!finished) {
                    finished = true;
                    operations.push('progress:finish');
                }
            },
            ready: async () => ({ mode: 'none', ts: null }),
            abort() {},
            terminalConfirmed: () => false,
            ts: () => null,
        };
    },
    statusFromToolEvent: () => null,
} });
const slackApi = await import('../../src/slack/api.ts');
mock.module('../../src/slack/api.ts', { namedExports: { ...slackApi,
    slackApi: async (_token: string, method: string) => {
        if (method.startsWith('chat.')) operations.push(`slack-api:${method}`);
        return { ok: true, data: { ts: 'notice-ts' } };
    },
} });
mock.module('../../src/slack/notice-transport.ts', { namedExports: {
    createSlackNoticeTransport: () => ({
        delete: async () => { operations.push('notice:delete'); },
        edit: async () => { operations.push('notice:edit'); },
    }),
} });

const slack = await import('../../src/slack/bot.ts');
const target = () => ({ channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'C1' });

async function drain() {
    for (let n = 0; n < 20; n++) await new Promise(resolve => setImmediate(resolve));
}

async function run() {
    activeRequest = `slack-delivery-${++id}`;
    return slack.processSlackMessageEvent(
        { user: 'U1', ts: String(id), channel: 'C1' } as never,
        target() as never,
        'prompt',
        new AbortController().signal,
    );
}

test.before(() => {
    Object.assign(settings, {
        multiSession: { enabled: false },
        slack: {
            enabled: true, botToken: 'fake', appToken: 'fake', channelIds: ['C1'],
            conversationContext: false, progress: { enabled: true },
        },
    });
});
test.beforeEach(() => {
    operations.length = 0;
    completion = {};
    body = 'answer';
    queued = false;
    sendCalls = 0;
    sendSlackTextImpl = defaultSend;
});

test('the direct path and the queued tracker deliver through the same helper', async () => {
    await run();
    await drain();
    const direct = [...operations];
    assertSlackBodyOrder(direct, 'answer');

    queued = true;
    const pending = run();
    await pending;
    operations.length = 0;
    broadcast('orchestrate_done', {
        origin: 'slack', requestId: activeRequest, scope: 'default', sessionId: 'default', text: 'answer',
        fromQueue: true, target: target(),
    });
    await drain();
    const tracked = [...operations];
    assertSlackBodyOrder(tracked, 'answer');
    assert.deepEqual(deliverySpine(direct, 'answer'), deliverySpine(tracked, 'answer'));
});

test('a steer-superseded turn posts no placeholder', async () => {
    body = '';
    completion = { superseded: true };
    await run();
    await drain();
    assert.equal(sendCalls, 0, `superseded turn must not call sendSlackText: ${JSON.stringify(operations)}`);
    assert.equal(operations.filter(value => value.startsWith('post:slack:')).length, 0, JSON.stringify(operations));
    assert.equal(operations.filter(value => value === 'ack:success').length, 1, JSON.stringify(operations));
});

test('the ACK settles when the body is posted, before readback verification finishes', { timeout: 3_000 }, async () => {
    const posted = Promise.withResolvers<void>();
    const verify = Promise.withResolvers<void>();
    sendSlackTextImpl = async (_token, _target, text, opts) => {
        sendCalls += 1;
        operations.push(`post:slack:${text}`);
        await opts?.onPosted?.({ ts: 'x', messageTs: ['x'], postedChunks: 1, totalChunks: 1 });
        posted.resolve();
        await verify.promise;
        operations.push('send:resolved');
        return { ok: true, ts: 'x' };
    };
    const pending = run();
    await posted.promise;
    operations.push('send:released');
    verify.resolve();
    await pending;
    await drain();
    assert.ok(operations.includes('ack:success'), JSON.stringify(operations));
    assert.ok(
        operations.indexOf('ack:success') < operations.indexOf('send:released'),
        `ACK must settle before send resolves: ${JSON.stringify(operations)}`,
    );
    assert.ok(operations.indexOf('ack:success') < operations.indexOf('send:resolved'));
});

test('the outbound answer log masks credentials the agent echoed', async t => {
    // #697 names src/slack/bot.ts as a hot path whose masking fixes landed
    // without tests. This line writes AGENT OUTPUT to the log ring and the
    // console on every delivered turn, so it is where a credential the model
    // repeated back would actually leak - and #686 just moved it out of
    // runReply into the shared helper's onSent hook, which is exactly when an
    // unasserted contract quietly stops holding.
    const secret = ['xoxb', '1234567890', '1234567890', 'abcdefghijklmnopqrstuvwx'].join('-');
    const masked = redactChannelSecrets(secret);
    const lines: string[] = [];
    t.mock.method(log, 'info', (...args: unknown[]) => { lines.push(args.map(value => String(value)).join(' ')); });

    // The masker runs before the 80-character truncation, so putting the
    // credential first keeps this about masking rather than about slicing.
    body = `${secret} is the token you asked about`;
    await run();
    await drain();

    const outbound = lines.find(line => line.startsWith('[slack:out'));
    assert.ok(outbound, `no outbound log line was emitted: ${JSON.stringify(lines)}`);
    assert.ok(!outbound.includes(secret), `raw credential reached the log: ${outbound}`);
    assert.ok(outbound.includes(masked), `masked form missing: ${outbound}`);
});

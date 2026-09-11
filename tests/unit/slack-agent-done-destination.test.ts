import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSlackForwarder } from '../../src/slack/forwarder.ts';
import { setLastActiveTarget } from '../../src/messaging/runtime.ts';
import type { RemoteTarget } from '../../src/messaging/types.ts';

const runTarget: RemoteTarget = {
    channel: 'slack',
    targetKind: 'channel',
    peerKind: 'channel',
    targetId: 'C_RUN',
    threadId: '1710000000.000200',
};

const newestConversation: RemoteTarget = {
    channel: 'slack',
    targetKind: 'channel',
    peerKind: 'channel',
    targetId: 'C_NEWEST',
    threadId: '1710000000.000300',
};

test('SAD-742: agent_done stays on its captured thread after last-active moves', async t => {
    const posts: Array<Record<string, unknown>> = [];
    t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
        assert.equal(String(url), 'https://slack.com/api/chat.postMessage');
        posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ ok: true, ts: '1710000000.000201' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    });

    // The exact incident order: a run owns one conversation, then somebody
    // speaks elsewhere before that run finishes. The global slot now points at
    // the new conversation, but the terminal event still belongs to the first.
    setLastActiveTarget('slack', runTarget);
    // A new mention arrives while the first run is still working.
    setLastActiveTarget('slack', newestConversation);
    const forward = createSlackForwarder({ getToken: () => 'xoxb-fixture' });
    await forward('agent_done', {
        origin: 'web',
        requestId: 'request-run',
        scope: 'scope-run',
        sessionId: 'session-run',
        remoteKey: 'jaw:slack:channel:C_RUN:thread:1710000000.000200',
        target: runTarget,
        text: 'answer for the run',
    });

    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.['channel'], runTarget.targetId);
    assert.equal(posts[0]?.['thread_ts'], runTarget.threadId);
    assert.equal(posts[0]?.['text'], 'answer for the run');
    assert.notEqual(posts[0]?.['channel'], newestConversation.targetId);
});

test('SAD-742: a targetless terminal never borrows last-active', async t => {
    let fetches = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        fetches++;
        throw new Error('targetless completion must not reach the transport');
    });

    setLastActiveTarget('slack', newestConversation);
    const forward = createSlackForwarder({ getToken: () => 'xoxb-fixture' });
    await forward('agent_done', {
        origin: 'web',
        requestId: 'request-web',
        scope: 'scope-web',
        sessionId: 'session-web',
        text: 'web-only answer',
    });

    assert.equal(fetches, 0);
});

test('SAD-742: a terminal addressed to another transport never reaches Slack', async t => {
    let fetches = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        fetches++;
        throw new Error('cross-channel completion must not reach Slack');
    });

    const forward = createSlackForwarder({ getToken: () => 'xoxb-fixture' });
    await forward('agent_done', {
        origin: 'web',
        target: {
            channel: 'discord',
            targetKind: 'channel',
            peerKind: 'channel',
            targetId: 'D_RUN',
        },
        text: 'discord answer',
    });

    assert.equal(fetches, 0);
});

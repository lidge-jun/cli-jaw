import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveHeartbeatBinding,
    isCompleteHeartbeatDestination,
    heartbeatHoldMessage,
    verifyHeartbeatThreadBindingLive,
} from '../../src/memory/heartbeat-destination.ts';

// HDB — a scheduled report goes to the conversation an operator named, or it
// does not go. Every "held" case below used to be a send to somewhere nobody
// chose: the active channel, or a channel root standing in for a thread the
// form never collected (#437, #745).

test('HDB-001 a channel and thread bind to exactly that thread', () => {
    const binding = resolveHeartbeatBinding({
        channel: 'slack', targetId: 'C_REPORTS', threadId: '1787616871.254919' });
    assert.equal(binding.state, 'bound');
    assert.equal(binding.state === 'bound' && binding.target.targetId, 'C_REPORTS');
    assert.equal(binding.state === 'bound' && binding.target.threadId, '1787616871.254919');
    assert.equal(binding.state === 'bound' && binding.target.channel, 'slack');
});

test('HDB-002 a missing destination is held, never resolved to an active channel', () => {
    for (const absent of [undefined, null]) {
        const binding = resolveHeartbeatBinding(absent);
        assert.equal(binding.state, 'held');
        assert.equal(binding.state === 'held' && binding.reason, 'unbound_destination');
    }
});

test('HDB-003 a Slack channel without a thread is held, not posted to the root', () => {
    const binding = resolveHeartbeatBinding({ channel: 'slack', targetId: 'C_REPORTS' });
    assert.equal(binding.state, 'held');
    assert.equal(binding.state === 'held' && binding.reason, 'incomplete_destination');
});

test('HDB-004 channel_root is the explicit way to mean the channel itself', () => {
    const binding = resolveHeartbeatBinding({
        channel: 'slack', targetId: 'C_REPORTS', scope: 'channel_root' });
    assert.equal(binding.state, 'bound');
    assert.equal(binding.state === 'bound' && binding.target.threadId, undefined);
});

test('HDB-005 a blank thread ts is not a thread', () => {
    // It passed shape validation and then read as falsy at send time, which
    // turned a threaded job into a root post with no diagnostic anywhere.
    assert.equal(isCompleteHeartbeatDestination({
        channel: 'slack', targetId: 'C_REPORTS', threadId: '   ' }), false);
    const binding = resolveHeartbeatBinding({ channel: 'slack', targetId: 'C_REPORTS', threadId: '' });
    assert.equal(binding.state, 'held');
    assert.equal(binding.state === 'held' && binding.reason, 'incomplete_destination');
});

test('HDB-006 a malformed destination is distinguishable from an absent one', () => {
    for (const bad of [{ channel: 'slack' }, { channel: 'irc', targetId: 'C_X' }, { targetId: 'C_X' },
        { channel: 'slack', targetId: 'C_X', scope: 'dm' }, 'slack', 42]) {
        const binding = resolveHeartbeatBinding(bad);
        assert.equal(binding.state, 'held', JSON.stringify(bad));
        assert.equal(binding.state === 'held' && binding.reason, 'malformed_destination', JSON.stringify(bad));
    }
});

test('HDB-007 non-Slack transports keep their conversation-level contract', () => {
    // Telegram and Discord do not carry Slack's thread model, so requiring one
    // there would hold every working job for a field it cannot supply.
    for (const channel of ['telegram', 'discord'] as const) {
        const binding = resolveHeartbeatBinding({ channel, targetId: '12345' });
        assert.equal(binding.state, 'bound', channel);
    }
});

test('HDB-008 every hold reason explains itself without leaking anything', () => {
    for (const reason of ['unbound_destination', 'incomplete_destination', 'malformed_destination',
        'thread_channel_mismatch', 'stale_thread', 'live_lookup_failed',
        'slack_grant_unavailable'] as const) {
        const message = heartbeatHoldMessage(reason);
        assert.ok(message.length > 0);
        assert.equal(/xox[bp]-|token|secret/i.test(message), false);
    }
});

function replies(payload: Record<string, unknown>, inspect?: (body: URLSearchParams) => void) {
    return (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = new URLSearchParams(String(init?.body ?? ''));
        inspect?.(body);
        return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }) as typeof fetch;
}

const threaded = {
    channel: 'slack' as const,
    targetId: 'C_REPORTS',
    threadId: '1787616871.254919',
};

test('HDB-L01 live verification accepts only the configured parent in the configured channel', async () => {
    let calls = 0;
    const result = await verifyHeartbeatThreadBindingLive(threaded, {
        token: 'xoxb-fixture',
        fetchImpl: replies({
            ok: true,
            messages: [{ ts: threaded.threadId, text: 'parent' }],
            has_more: false,
        }, body => {
            calls++;
            assert.equal(body.get('channel'), threaded.targetId);
            assert.equal(body.get('ts'), threaded.threadId);
            assert.equal(body.get('limit'), '1');
        }),
    });
    assert.equal(result.state, 'bound');
    assert.equal(calls, 1);
});

test('HDB-L02 a different or empty parent fails closed as a channel-thread mismatch', async () => {
    for (const messages of [[], [{ ts: '1787616871.999999', text: 'other' }]]) {
        const result = await verifyHeartbeatThreadBindingLive(threaded, {
            token: 'xoxb-fixture',
            fetchImpl: replies({ ok: true, messages, has_more: false }),
        });
        assert.deepEqual(result, { state: 'held', reason: 'thread_channel_mismatch' });
    }
});

test('HDB-L03 Slack error classes become stable hold reasons without retry', async () => {
    const cases = [
        ['message_not_found', 'stale_thread'],
        ['thread_not_found', 'stale_thread'],
        ['channel_not_found', 'thread_channel_mismatch'],
        ['not_in_channel', 'thread_channel_mismatch'],
        ['missing_scope', 'live_lookup_failed'],
        ['no_permission', 'live_lookup_failed'],
        ['ratelimited', 'live_lookup_failed'],
        ['invalid_auth', 'live_lookup_failed'],
        ['internal_error', 'live_lookup_failed'],
    ] as const;
    for (const [code, reason] of cases) {
        let calls = 0;
        const result = await verifyHeartbeatThreadBindingLive(threaded, {
            token: 'xoxb-fixture',
            fetchImpl: replies({ ok: false, error: code }, () => { calls++; }),
        });
        assert.deepEqual(result, { state: 'held', reason }, code);
        assert.equal(calls, 1, code + ' must not retry inside a heartbeat tick');
    }
});

test('HDB-L04 missing credentials and transport exceptions fail this tick closed', async () => {
    assert.deepEqual(await verifyHeartbeatThreadBindingLive(threaded, { token: '' }),
        { state: 'held', reason: 'live_lookup_failed' });
    assert.deepEqual(await verifyHeartbeatThreadBindingLive(threaded, {
        token: 'xoxb-fixture',
        fetchImpl: (async () => { throw new Error('network down'); }) as typeof fetch,
    }), { state: 'held', reason: 'live_lookup_failed' });
});

test('HDB-L05 channel_root and non-Slack destinations require no Slack read', async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; throw new Error('must not fetch'); }) as typeof fetch;
    for (const destination of [
        { channel: 'slack', targetId: 'C_REPORTS', scope: 'channel_root' },
        { channel: 'telegram', targetId: '123' },
        { channel: 'discord', targetId: '456' },
    ]) {
        assert.equal((await verifyHeartbeatThreadBindingLive(destination, {
            token: '',
            fetchImpl,
        })).state, 'bound');
    }
    assert.equal(calls, 0);
});

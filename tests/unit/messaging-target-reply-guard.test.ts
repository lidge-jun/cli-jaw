import { test } from 'node:test';
import assert from 'node:assert/strict';

import { admitTargetReply, type TargetReplyGuardOptions } from '../../src/messaging/target-reply-guard.ts';
import type { MessengerChannel, RemoteTarget } from '../../src/messaging/types.ts';

const target = (channel: MessengerChannel, over: Partial<RemoteTarget> = {}): RemoteTarget => ({
    channel, targetKind: 'channel', peerKind: 'channel', targetId: 'C1', ...over,
});

/** The three forwarders as they are actually installed (#699). */
const SLACK: TargetReplyGuardOptions = {
    channel: 'slack', event: 'orchestrate_done',
    accept: ['fromQueue', 'fromSteer', 'replyViaTarget'],
};
const TELEGRAM: TargetReplyGuardOptions = {
    channel: 'telegram', event: 'orchestrate_done',
    accept: ['replyViaTarget'], requireText: true,
};
const DISCORD: TargetReplyGuardOptions = {
    channel: 'discord', event: 'orchestrate_done',
    accept: ['fromQueue'], requireText: true,
};

const done = (channel: MessengerChannel, over: Record<string, unknown> = {}) => ({
    origin: channel, text: 'answer', target: target(channel), ...over,
});

// ─── The guard split the three bots had drifted into ───
// This is the difference #699 asked to be pinned. It is a real per-channel
// decision, not an accident: a channel whose dispatch path already answers
// ordinary turns must not answer them here too.

test('TRG-001: Discord admits fromQueue and nothing else', () => {
    assert.ok(admitTargetReply('orchestrate_done', done('discord', { fromQueue: true }), DISCORD));
    assert.equal(admitTargetReply('orchestrate_done', done('discord', { replyViaTarget: true }), DISCORD), null);
    assert.equal(admitTargetReply('orchestrate_done', done('discord', { fromSteer: true }), DISCORD), null);
    assert.equal(admitTargetReply('orchestrate_done', done('discord'), DISCORD), null);
});

test('TRG-002: Telegram admits replyViaTarget and nothing else', () => {
    assert.ok(admitTargetReply('orchestrate_done', done('telegram', { replyViaTarget: true }), TELEGRAM));
    assert.equal(admitTargetReply('orchestrate_done', done('telegram', { fromQueue: true }), TELEGRAM), null);
    assert.equal(admitTargetReply('orchestrate_done', done('telegram', { fromSteer: true }), TELEGRAM), null);
});

test('TRG-003: Slack admits all three orphan identities', () => {
    // A mid-run steer leaves no waiter for the follow-up answer (#655), which is
    // the same shape of orphan as a queued turn.
    for (const identity of ['fromQueue', 'fromSteer', 'replyViaTarget']) {
        assert.ok(admitTargetReply('orchestrate_done', done('slack', { [identity]: true }), SLACK), identity);
    }
    assert.equal(admitTargetReply('orchestrate_done', done('slack'), SLACK), null);
});

test('TRG-004: only the literal boolean true is an identity', () => {
    for (const forged of ['true', 1, {}, [], 'yes']) {
        assert.equal(admitTargetReply('orchestrate_done', done('discord', { fromQueue: forged }), DISCORD), null,
            JSON.stringify(forged));
    }
});

// ─── Shared admission ───────────────────────────────

test('TRG-005: another event type is never admitted', () => {
    assert.equal(admitTargetReply('agent_done', done('slack', { fromQueue: true }), SLACK), null);
    assert.equal(admitTargetReply('steer_started', done('slack', { fromQueue: true }), SLACK), null);
});

test('TRG-006: origin and target channel must BOTH be this channel', () => {
    // isRemoteTarget only proves the channel is SOME messenger, so the guard has
    // to compare both fields itself.
    assert.equal(admitTargetReply('orchestrate_done',
        { origin: 'telegram', text: 'x', target: target('slack'), fromQueue: true }, SLACK), null);
    assert.equal(admitTargetReply('orchestrate_done',
        { origin: 'slack', text: 'x', target: target('telegram'), fromQueue: true }, SLACK), null);
});

test('TRG-007: a malformed address is rejected rather than sent to last-active', () => {
    // Telegram and Discord used to cast this without checking. An empty targetId
    // reached a transport that then fell back to the last-active chat, so the
    // answer landed in a conversation nobody asked in.
    const bad: Array<unknown> = [
        undefined, null, 'C1', {},
        { channel: 'telegram', targetKind: 'channel', peerKind: 'channel', targetId: '' },
        { channel: 'telegram', targetKind: 'channel', peerKind: 'channel' },
        { channel: 'telegram', targetKind: 'nonsense', peerKind: 'channel', targetId: 'C1' },
        { channel: 'telegram', targetKind: 'channel', peerKind: 'channel', targetId: 'C1', threadId: 7 },
    ];
    for (const value of bad) {
        assert.equal(admitTargetReply('orchestrate_done',
            { origin: 'telegram', text: 'x', target: value, replyViaTarget: true }, TELEGRAM), null,
            JSON.stringify(value));
    }
});

test('TRG-008: the admitted target is a copy, so a listener cannot mutate the payload', () => {
    const payload = done('slack', { fromQueue: true });
    const admitted = admitTargetReply('orchestrate_done', payload, SLACK);
    assert.ok(admitted);
    admitted.target.targetId = 'MUTATED';
    assert.equal((payload.target as RemoteTarget).targetId, 'C1');
});

// ─── Live waiter ────────────────────────────────────

test('TRG-009: a live waiter suppresses the fallback, so the answer is not posted twice', () => {
    const waited: string[] = [];
    const opts = { ...DISCORD, hasPendingWaiter: (id: string) => { waited.push(id); return id === 'R1'; } };
    assert.equal(admitTargetReply('orchestrate_done', done('discord', { fromQueue: true, requestId: 'R1' }), opts), null);
    assert.ok(admitTargetReply('orchestrate_done', done('discord', { fromQueue: true, requestId: 'R2' }), opts));
    assert.deepEqual(waited, ['R1', 'R2']);
});

test('TRG-010: Telegram asks no waiter, because it keeps no pending queue ids', () => {
    assert.equal(TELEGRAM.hasPendingWaiter, undefined);
    const admitted = admitTargetReply('orchestrate_done',
        done('telegram', { replyViaTarget: true, requestId: 'R1' }), TELEGRAM);
    assert.equal(admitted?.requestId, 'R1');
});

test('TRG-011: a non-string request id is still stringified for the waiter lookup', () => {
    const seen: string[] = [];
    const opts = { ...DISCORD, hasPendingWaiter: (id: string) => { seen.push(id); return false; } };
    const admitted = admitTargetReply('orchestrate_done', done('discord', { fromQueue: true, requestId: 7 }), opts);
    assert.deepEqual(seen, ['7']);
    // The returned id stays string-typed, which is what the notice store needs.
    assert.equal(admitted?.requestId, '');
});

// ─── Text and shutdown ──────────────────────────────

test('TRG-012: Telegram and Discord reject falsy text at admission; Slack does not', () => {
    for (const empty of ['', undefined, null, 0]) {
        assert.equal(admitTargetReply('orchestrate_done',
            done('discord', { fromQueue: true, text: empty }), DISCORD), null, JSON.stringify(empty));
    }
    // Slack rewrites an error payload into its own failure copy, so it cannot
    // decide emptiness before that rewrite.
    assert.ok(admitTargetReply('orchestrate_done', done('slack', { fromQueue: true, text: '' }), SLACK));
});

test('TRG-013: a stopping channel admits nothing', () => {
    let stopping = false;
    const opts = { ...SLACK, stopping: () => stopping };
    assert.ok(admitTargetReply('orchestrate_done', done('slack', { fromQueue: true }), opts));
    stopping = true;
    assert.equal(admitTargetReply('orchestrate_done', done('slack', { fromQueue: true }), opts), null);
});

test('TRG-014: native runtime tags are reported so the bot can require body delivery', () => {
    const native = admitTargetReply('orchestrate_done',
        done('discord', { fromQueue: true, runtimeFinality: 'present', runtimeStatus: 'done' }), DISCORD);
    assert.equal(native?.requireBodyDelivery, true);
    const legacy = admitTargetReply('orchestrate_done', done('discord', { fromQueue: true }), DISCORD);
    assert.equal(legacy?.requireBodyDelivery, false);
    // A half-tagged payload is not native: both tags have to be present.
    const half = admitTargetReply('orchestrate_done',
        done('discord', { fromQueue: true, runtimeStatus: 'done' }), DISCORD);
    assert.equal(half?.requireBodyDelivery, false);
});

test('TRG-015: an empty accept list admits nothing', () => {
    const opts = { ...DISCORD, accept: [] as const };
    assert.equal(admitTargetReply('orchestrate_done', done('discord', { fromQueue: true }), opts), null);
});

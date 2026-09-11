import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveHeartbeatBinding,
    isCompleteHeartbeatDestination,
    heartbeatHoldMessage,
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
    for (const reason of ['unbound_destination', 'incomplete_destination', 'malformed_destination'] as const) {
        const message = heartbeatHoldMessage(reason);
        assert.ok(message.length > 0);
        assert.equal(/xox[bp]-|token|secret/i.test(message), false);
    }
});

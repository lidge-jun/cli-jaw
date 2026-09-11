import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRunPin, sameRunConversation } from '../../src/messaging/run-pin.ts';
import type { RunPin } from '../../src/messaging/run-pin.ts';

const expected: RunPin = {
    requestId: 'request-1',
    origin: 'slack',
    scope: 'scope-1',
    sessionId: 'session-1',
    remoteKey: 'jaw:slack:channel:C1:thread:1.1',
    target: {
        channel: 'slack',
        targetKind: 'channel',
        peerKind: 'channel',
        targetId: 'C1',
        threadId: '1.1',
    },
};

test('RP-001 a complete identical pin matches', () => {
    assert.equal(matchesRunPin(expected, { ...expected, target: { ...expected.target } }), true);
});

test('RP-002 every core identity field is required', () => {
    for (const field of ['requestId', 'origin', 'scope', 'sessionId'] as const) {
        const actual = { ...expected, target: { ...expected.target } };
        delete actual[field];
        assert.equal(matchesRunPin(expected, actual), false, field);
    }
});

test('RP-003 a remote waiter requires the same remoteKey and target', () => {
    assert.equal(matchesRunPin(expected, {
        ...expected,
        remoteKey: 'jaw:slack:channel:C2:thread:2.2',
        target: { ...expected.target },
    }), false);
    assert.equal(matchesRunPin(expected, {
        ...expected,
        target: { ...expected.target, threadId: '2.2' },
    }), false);
});

test('RP-004 a local waiter does not invent remote fields', () => {
    const local: RunPin = {
        requestId: 'request-local',
        origin: 'web',
        scope: 'scope-local',
        sessionId: 'session-local',
    };
    assert.equal(matchesRunPin(local, { ...local }), true);
});

test('RP-005 remote conversation equality follows remoteKey, not reply placement', () => {
    assert.equal(sameRunConversation(
        { origin: 'slack', remoteKey: 'jaw:slack:channel:C1', target: { ...expected.target!, threadId: '1.1' } },
        { origin: 'slack', remoteKey: 'jaw:slack:channel:C1', target: { ...expected.target!, threadId: '2.2' } },
    ), true, 'synthetic reply placement must not mint another conversation');
    assert.equal(sameRunConversation(
        { origin: 'slack', remoteKey: 'jaw:slack:channel:C1' },
        { origin: 'slack', remoteKey: 'jaw:slack:channel:C2' },
    ), false);
});

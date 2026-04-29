import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createSession,
    getSession,
    findSessionByTarget,
    updateSessionStatus,
    setSessionNotifyOnComplete,
    updateSessionResult,
    listSessions,
    listNotifications,
    markNotificationDelivered,
    clearSession,
    assertSameTarget,
    WrongTargetError,
    __resetSessionState,
} from '../../src/browser/web-ai/session.js';

const baseEnvelope = { vendor: 'chatgpt' as const, prompt: 'hi', attachmentPolicy: 'inline-only' as const };

test('SESS-001: createSession generates a sessionId and is retrievable', () => {
    __resetSessionState();
    const s = createSession({ vendor: 'chatgpt', targetId: 't1', url: 'https://chatgpt.com/c/x', conversationUrl: 'https://chatgpt.com/c/x', envelope: baseEnvelope, assistantCount: 3, timeoutMs: 60_000 });
    assert.ok(s.sessionId);
    assert.equal(getSession(s.sessionId)?.targetId, 't1');
});

test('SESS-002: findSessionByTarget returns the live session', () => {
    __resetSessionState();
    const s = createSession({ vendor: 'chatgpt', targetId: 't2', url: 'u', conversationUrl: 'u', envelope: baseEnvelope, assistantCount: 0, timeoutMs: 60_000 });
    assert.equal(findSessionByTarget('chatgpt', 't2')?.sessionId, s.sessionId);
});

test('SESS-003: assertSameTarget throws WrongTargetError when target diverges', () => {
    __resetSessionState();
    const s = createSession({ vendor: 'chatgpt', targetId: 'tA', url: 'u', conversationUrl: 'u', envelope: baseEnvelope, assistantCount: 0, timeoutMs: 60_000 });
    assert.throws(() => assertSameTarget(s, 'tDIFFERENT'), WrongTargetError);
    assert.doesNotThrow(() => assertSameTarget(s, 'tA'));
});

test('SESS-004: updateSessionStatus transitions and clearSession removes session', () => {
    __resetSessionState();
    const s = createSession({ vendor: 'chatgpt', targetId: 'tC', url: 'u', conversationUrl: 'u', envelope: baseEnvelope, assistantCount: 0, timeoutMs: 60_000 });
    updateSessionStatus(s.sessionId, 'streaming');
    assert.equal(getSession(s.sessionId)?.status, 'streaming');
    updateSessionStatus(s.sessionId, 'complete');
    assert.equal(getSession(s.sessionId)?.status, 'complete');
    clearSession(s.sessionId);
    assert.equal(getSession(s.sessionId), null);
});

test('SESS-005: sessions persist answer metadata for watcher reattach', () => {
    __resetSessionState();
    const s = createSession({ vendor: 'gemini', targetId: 'tW', url: 'https://gemini.google.com/app', conversationUrl: 'https://gemini.google.com/app', envelope: { vendor: 'gemini', prompt: 'watch me', attachmentPolicy: 'inline-only' }, assistantCount: 0, timeoutMs: 900_000 });
    updateSessionResult({
        sessionId: s.sessionId,
        status: 'complete',
        url: 'https://gemini.google.com/app/abc',
        conversationUrl: 'https://gemini.google.com/app/abc',
        answerText: 'JAW_WATCH_OK',
    });

    const stored = getSession(s.sessionId);
    assert.equal(stored?.status, 'complete');
    assert.equal(stored?.conversationUrl, 'https://gemini.google.com/app/abc');
    assert.equal(stored?.answerText, 'JAW_WATCH_OK');
    assert.ok(stored?.lastSeenTextHash);
    assert.ok(stored?.completedAt);
});

test('SESS-006: listSessions filters by vendor and status', () => {
    __resetSessionState();
    const chat = createSession({ vendor: 'chatgpt', targetId: 'tc', url: 'u', conversationUrl: 'u', envelope: baseEnvelope, assistantCount: 0, timeoutMs: 60_000 });
    const gemini = createSession({ vendor: 'gemini', targetId: 'tg', url: 'u', conversationUrl: 'u', envelope: { vendor: 'gemini', prompt: 'hi', attachmentPolicy: 'inline-only' }, assistantCount: 0, timeoutMs: 60_000 });
    updateSessionStatus(chat.sessionId, 'complete');
    updateSessionStatus(gemini.sessionId, 'streaming');

    assert.deepEqual(listSessions({ vendor: 'gemini' }).map((s) => s.sessionId), [gemini.sessionId]);
    assert.deepEqual(listSessions({ status: 'complete' }).map((s) => s.sessionId), [chat.sessionId]);
});

test('SESS-007: completed watched sessions enqueue one pending notification event', () => {
    __resetSessionState();
    const s = createSession({ vendor: 'chatgpt', targetId: 'tn', url: 'https://chatgpt.com/c/n', conversationUrl: 'https://chatgpt.com/c/n', envelope: baseEnvelope, assistantCount: 0, timeoutMs: 60_000 });
    setSessionNotifyOnComplete(s.sessionId, true);
    updateSessionResult({ sessionId: s.sessionId, status: 'complete', answerText: 'done answer', url: s.url, conversationUrl: s.conversationUrl });
    updateSessionResult({ sessionId: s.sessionId, status: 'complete', answerText: 'done answer', url: s.url, conversationUrl: s.conversationUrl });

    const events = listNotifications({ status: 'pending' });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'web-ai.answer.completed');
    assert.equal(events[0]?.sessionId, s.sessionId);
    assert.equal(events[0]?.answerExcerpt, 'done answer');
});

test('SESS-007B: non-watched completions do not enqueue notifications', () => {
    __resetSessionState();
    const s = createSession({ vendor: 'chatgpt', targetId: 'tn0', url: 'https://chatgpt.com/c/n0', conversationUrl: 'https://chatgpt.com/c/n0', envelope: baseEnvelope, assistantCount: 0, timeoutMs: 60_000 });
    updateSessionResult({ sessionId: s.sessionId, status: 'complete', answerText: 'quiet answer', url: s.url, conversationUrl: s.conversationUrl });

    assert.equal(listNotifications({ status: 'pending' }).length, 0);
});

test('SESS-008: notification delivery status is persisted in the event ledger', () => {
    __resetSessionState();
    const s = createSession({ vendor: 'gemini', targetId: 'td', url: 'https://gemini.google.com/app', conversationUrl: 'https://gemini.google.com/app', envelope: { vendor: 'gemini', prompt: 'hi', attachmentPolicy: 'inline-only' }, assistantCount: 0, timeoutMs: 60_000 });
    setSessionNotifyOnComplete(s.sessionId, true);
    updateSessionResult({ sessionId: s.sessionId, status: 'complete', answerText: 'gemini complete', url: s.url, conversationUrl: s.conversationUrl });
    const event = listNotifications({ vendor: 'gemini', status: 'pending' })[0];
    assert.ok(event);

    markNotificationDelivered({ eventId: event.eventId, status: 'sent' });
    assert.equal(listNotifications({ status: 'pending' }).length, 0);
    assert.equal(listNotifications({ status: 'sent' })[0]?.eventId, event.eventId);
});

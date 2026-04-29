import test from 'node:test';
import assert from 'node:assert/strict';
import {
    __resetSessionState,
    createSession,
    getSession,
    listNotifications,
    updateSessionResult,
} from '../../src/browser/web-ai/session.js';
import {
    listActiveWebAiWatchers,
    resumeStoredWebAiWatchers,
    startWebAiWatcher,
    stopWebAiWatchers,
} from '../../src/browser/web-ai/watcher.js';

const envelope = { vendor: 'chatgpt' as const, prompt: 'watch', attachmentPolicy: 'inline-only' as const };

test('WEB-AI-WATCH-001: startWebAiWatcher returns immediately and dedupes by session', () => {
    __resetSessionState();
    stopWebAiWatchers();
    const s = createSession({ vendor: 'chatgpt', targetId: 'tw1', url: 'u', conversationUrl: 'u', envelope, assistantCount: 0, timeoutMs: 60_000 });
    const pollOnce = async () => ({ ok: false as const, vendor: 'chatgpt' as const, status: 'timeout' as const, warnings: [] });

    const first = startWebAiWatcher({ port: 1, vendor: 'chatgpt', sessionId: s.sessionId, timeoutMs: 60_000, pollOnce });
    const second = startWebAiWatcher({ port: 1, vendor: 'chatgpt', sessionId: s.sessionId, timeoutMs: 60_000, pollOnce });

    assert.equal(first.sessionId, s.sessionId);
    assert.deepEqual(second, first);
    assert.equal(listActiveWebAiWatchers().length, 1);
    stopWebAiWatchers();
});

test('WEB-AI-WATCH-002: successful poll completion clears active watcher', async () => {
    __resetSessionState();
    stopWebAiWatchers();
    const s = createSession({ vendor: 'chatgpt', targetId: 'tw2', url: 'u', conversationUrl: 'u', envelope, assistantCount: 0, timeoutMs: 60_000 });
    const pollOnce = async () => {
        updateSessionResult({ sessionId: s.sessionId, status: 'complete', answerText: 'watch done' });
        return { ok: true as const, vendor: 'chatgpt' as const, status: 'complete' as const, answerText: 'watch done', warnings: [] };
    };

    startWebAiWatcher({ port: 1, vendor: 'chatgpt', sessionId: s.sessionId, timeoutMs: 60_000, pollOnce });
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(getSession(s.sessionId)?.status, 'complete');
    assert.equal(listActiveWebAiWatchers().length, 0);
});

test('WEB-AI-WATCH-003: resumeStoredWebAiWatchers restores only notify-enabled pending sessions', () => {
    __resetSessionState();
    stopWebAiWatchers();
    const watched = createSession({ vendor: 'chatgpt', targetId: 'tw3', url: 'u', conversationUrl: 'u', envelope, assistantCount: 0, timeoutMs: 60_000, notifyOnComplete: true });
    createSession({ vendor: 'chatgpt', targetId: 'tw4', url: 'u', conversationUrl: 'u', envelope, assistantCount: 0, timeoutMs: 60_000 });
    const pollOnce = async () => ({ ok: false as const, vendor: 'chatgpt' as const, status: 'timeout' as const, warnings: [] });

    const resumed = resumeStoredWebAiWatchers({ port: 1, vendor: 'chatgpt', pollOnce });

    assert.deepEqual(resumed.map((watcher) => watcher.sessionId), [watched.sessionId]);
    assert.equal(getSession(watched.sessionId)?.notifyOnComplete, true);
    assert.equal(listActiveWebAiWatchers().length, 1);
    stopWebAiWatchers();
});

test('WEB-AI-WATCH-004: watcher rejects unknown, wrong-vendor, and terminal sessions', () => {
    __resetSessionState();
    stopWebAiWatchers();
    const s = createSession({ vendor: 'chatgpt', targetId: 'tw5', url: 'u', conversationUrl: 'u', envelope, assistantCount: 0, timeoutMs: 60_000 });
    updateSessionResult({ sessionId: s.sessionId, status: 'complete', answerText: 'done' });
    const pollOnce = async () => ({ ok: false as const, vendor: 'chatgpt' as const, status: 'timeout' as const, warnings: [] });

    assert.throws(() => startWebAiWatcher({ port: 1, vendor: 'chatgpt', sessionId: 'missing', timeoutMs: 60_000, pollOnce }), /not found/);
    assert.throws(() => startWebAiWatcher({ port: 1, vendor: 'gemini', sessionId: s.sessionId, timeoutMs: 60_000, pollOnce }), /vendor mismatch/);
    assert.throws(() => startWebAiWatcher({ port: 1, vendor: 'chatgpt', sessionId: s.sessionId, timeoutMs: 60_000, pollOnce }), /terminal session/);
});

test('WEB-AI-WATCH-005: expired session is marked stale and notified before watcher registration', async () => {
    __resetSessionState();
    stopWebAiWatchers();
    const s = createSession({ vendor: 'chatgpt', targetId: 'tw6', url: 'u', conversationUrl: 'u', envelope, assistantCount: 0, timeoutMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const pollOnce = async () => ({ ok: false as const, vendor: 'chatgpt' as const, status: 'timeout' as const, warnings: [] });

    assert.throws(() => startWebAiWatcher({ port: 1, vendor: 'chatgpt', sessionId: s.sessionId, timeoutMs: 60_000, pollOnce }), /expired/);
    assert.equal(getSession(s.sessionId)?.status, 'timeout');
    assert.equal(listNotifications({ sessionId: s.sessionId })[0]?.type, 'web-ai.session.stale');
    assert.equal(listActiveWebAiWatchers().length, 0);
});

test('WEB-AI-WATCH-006: watcher persists completion even when pollOnce only returns it', async () => {
    __resetSessionState();
    stopWebAiWatchers();
    const s = createSession({ vendor: 'chatgpt', targetId: 'tw7', url: 'u', conversationUrl: 'u', envelope, assistantCount: 0, timeoutMs: 60_000 });
    const pollOnce = async () => ({ ok: true as const, vendor: 'chatgpt' as const, status: 'complete' as const, answerText: 'persisted by watcher', url: 'u2', warnings: [] });

    startWebAiWatcher({ port: 1, vendor: 'chatgpt', sessionId: s.sessionId, timeoutMs: 60_000, pollOnce });
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(getSession(s.sessionId)?.status, 'complete');
    assert.equal(getSession(s.sessionId)?.answerText, 'persisted by watcher');
    assert.equal(listNotifications({ sessionId: s.sessionId }).length, 1);
    assert.equal(listActiveWebAiWatchers().length, 0);
});

test('WEB-AI-WATCH-007: active watchers serialize headed browser pollOnce calls', async () => {
    __resetSessionState();
    stopWebAiWatchers();
    const first = createSession({ vendor: 'chatgpt', targetId: 'tw8', url: 'u', conversationUrl: 'u', envelope, assistantCount: 0, timeoutMs: 60_000 });
    const second = createSession({ vendor: 'chatgpt', targetId: 'tw9', url: 'u', conversationUrl: 'u', envelope, assistantCount: 0, timeoutMs: 60_000 });
    let active = 0;
    let maxActive = 0;
    const pollOnce = async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return { ok: false as const, vendor: 'chatgpt' as const, status: 'timeout' as const, warnings: [] };
    };

    startWebAiWatcher({ port: 1, vendor: 'chatgpt', sessionId: first.sessionId, timeoutMs: 60_000, pollOnce, pollIntervalSeconds: 1 });
    startWebAiWatcher({ port: 1, vendor: 'chatgpt', sessionId: second.sessionId, timeoutMs: 60_000, pollOnce, pollIntervalSeconds: 1 });
    await new Promise((resolve) => setTimeout(resolve, 70));

    assert.equal(maxActive, 1);
    stopWebAiWatchers();
});

test('WEB-AI-WATCH-008: blocked login result creates login-required notification', async () => {
    __resetSessionState();
    stopWebAiWatchers();
    const s = createSession({ vendor: 'chatgpt', targetId: 'tw10', url: 'u', conversationUrl: 'u', envelope, assistantCount: 0, timeoutMs: 60_000 });
    const pollOnce = async () => ({ ok: false as const, vendor: 'chatgpt' as const, status: 'blocked' as const, error: 'login required', warnings: [] });

    startWebAiWatcher({ port: 1, vendor: 'chatgpt', sessionId: s.sessionId, timeoutMs: 60_000, pollOnce });
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(getSession(s.sessionId)?.status, 'error');
    assert.equal(listNotifications({ sessionId: s.sessionId })[0]?.type, 'web-ai.provider.login-required');
});

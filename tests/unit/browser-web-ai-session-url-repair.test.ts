import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createSession,
    getSession,
    discoverConversationUrl,
    __resetSessionState,
} from '../../src/browser/web-ai/session.js';
import { readFileSync } from 'node:fs';

const baseEnvelope = { vendor: 'chatgpt' as const, prompt: 'hi', attachmentPolicy: 'inline-only' as const };

test('URL-001: root URL session updated when /c/ URL discovered', () => {
    __resetSessionState();
    const s = createSession({
        vendor: 'chatgpt', targetId: 't1',
        url: 'https://chatgpt.com/', conversationUrl: 'https://chatgpt.com/',
        envelope: baseEnvelope, assistantCount: 0, timeoutMs: 60_000,
    });
    const updated = discoverConversationUrl(s.sessionId, 'https://chatgpt.com/c/abc-123-def');
    assert.equal(updated, true);
    assert.equal(getSession(s.sessionId)?.conversationUrl, 'https://chatgpt.com/c/abc-123-def');
});

test('URL-002: session with existing /c/ URL not overwritten', () => {
    __resetSessionState();
    const s = createSession({
        vendor: 'chatgpt', targetId: 't2',
        url: 'https://chatgpt.com/c/original', conversationUrl: 'https://chatgpt.com/c/original',
        envelope: baseEnvelope, assistantCount: 0, timeoutMs: 60_000,
    });
    const updated = discoverConversationUrl(s.sessionId, 'https://chatgpt.com/c/different');
    assert.equal(updated, false);
    assert.equal(getSession(s.sessionId)?.conversationUrl, 'https://chatgpt.com/c/original');
});

test('URL-003: non /c/ URL does not update session', () => {
    __resetSessionState();
    const s = createSession({
        vendor: 'chatgpt', targetId: 't3',
        url: 'https://chatgpt.com/', conversationUrl: 'https://chatgpt.com/',
        envelope: baseEnvelope, assistantCount: 0, timeoutMs: 60_000,
    });
    const updated = discoverConversationUrl(s.sessionId, 'https://chatgpt.com/');
    assert.equal(updated, false);
    assert.equal(getSession(s.sessionId)?.conversationUrl, 'https://chatgpt.com/');
});

test('URL-004: nonexistent session returns false', () => {
    __resetSessionState();
    const updated = discoverConversationUrl('nonexistent-id', 'https://chatgpt.com/c/abc');
    assert.equal(updated, false);
});

test('URL-005: session page binding trusts live post-submit conversation URL', () => {
    const src = readFileSync(new URL('../../src/browser/web-ai/chatgpt.ts', import.meta.url), 'utf8');
    assert.match(src, /discoverConversationUrl\(sessionId, liveUrl\)/);
    assert.match(src, /updated \|\| current/);
});

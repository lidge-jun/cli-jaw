import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../../src/core/config.ts';
import { withSessionScope } from '../../src/core/session-context.ts';
import { createChatSession, getActiveChatSession, getChatSessionById, getRemoteBoundSessionId,
    resolveOrCreateRemoteSession, setActiveChatSession } from '../../src/core/chat-sessions.ts';

test('independent chat creation preserves global active chat and the captured remote binding', () => {
    settings.multiSession.enabled = true;
    const active = createChatSession('active fixture').id;
    const remoteKey = 'jaw:slack:inactive-create-fixture';
    const remoteChat = resolveOrCreateRemoteSession(remoteKey);
    const created = withSessionScope({ scope: remoteKey, chatSessionId: remoteChat },
        () => createChatSession('independent fixture', { activate: false }));
    assert.ok(getChatSessionById(created.id));
    assert.equal(getActiveChatSession(), active);
    assert.equal(getRemoteBoundSessionId(remoteKey), remoteChat);
    settings.multiSession.enabled = false;
    const local = createChatSession('independent single-session fixture', { activate: false });
    assert.ok(getChatSessionById(local.id));
    assert.equal(getActiveChatSession(), active);
    const normal = createChatSession('normal fixture');
    assert.equal(getActiveChatSession(), normal.id);
    setActiveChatSession('default');
});

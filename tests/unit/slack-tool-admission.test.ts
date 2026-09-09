import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../../src/core/config.ts';
import { admitSlackRun, resetSlackIngress } from '../../src/slack/ingress.ts';
import { activateSlackToolGrant, resolveSlackToolGrant, slackCredentialKey } from '../../src/slack/tool-context.ts';
import { pendingRequestIds } from '../../src/orchestrator/request-registry.ts';
import { db } from '../../src/core/db.ts';

test('real Slack admission preserves grant until owned run settles', async () => {
    await resetSlackIngress();
    settings.multiSession.enabled = false;
    const target = { channel: 'slack' as const, targetKind: 'channel' as const, peerKind: 'direct' as const, targetId: 'D1' };
    let secret = ''; let requestId = '';
    const result = admitSlackRun({ target, prompt: 'admission grant fixture', displayText: 'admission fixture', chatId: 'D1',
        toolSource: { teamId: 'T1', actorId: 'U1', destination: target, credentialKey: slackCredentialKey('fixture') },
        runReply: async ctx => {
            requestId = ctx.requestId;
            assert.ok(pendingRequestIds().includes(requestId));
            secret = activateSlackToolGrant(ctx.requestId, ctx.scope, ctx.chatSessionId) ?? '';
            assert.ok(secret, 'skipOrchestrate is ownership handoff, not completion');
            assert.equal(resolveSlackToolGrant(secret)?.actorId, 'U1');
        },
    });
    await result.laneTail;
    assert.equal(resolveSlackToolGrant(secret), null);
    assert.ok(!pendingRequestIds().includes(requestId));
    const rows = db.prepare('SELECT content FROM messages').all();
    assert.ok(!JSON.stringify(rows).includes(secret));
});

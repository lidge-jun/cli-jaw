import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueController } from '../../src/agent/spawn/queue.ts';
import { SessionLanes } from '../../src/orchestrator/session-lanes.ts';
import { reserveSlackToolGrant, activateSlackToolGrant, revokeSlackToolScope, slackCredentialKey } from '../../src/slack/tool-context.ts';

test('single-session Slack queue preserves admitted chat ownership across an active-tab change', async () => {
    let busy = true; let activeChat = 'captured-chat'; let activated = false;
    const persisted = new Map<string, string>();
    const target = { channel: 'slack' as const, targetKind: 'channel' as const, peerKind: 'direct' as const, targetId: 'D1' };
    reserveSlackToolGrant({ teamId: 'T1', actorId: 'U1', destination: target, credentialKey: slackCredentialKey('fixture') }, { requestId: 'queue-request', scope: 'default', chatSessionId: activeChat });
    const controller = createQueueController({
        migrateQueuedMessagesV1ToV2() {}, isSpawnBusy: () => busy, hasBlockingWorkers: () => false, hasPendingWorkerReplays: () => false,
        insertMessage: { run() {} }, insertQueuedMessage: { run(id: string, payload: string) { persisted.set(id, payload); } },
        deleteQueuedMessage: { run(id: string) { persisted.delete(id); } }, listQueuedMessages: { all: () => [] },
        getActiveChatSession: () => activeChat, broadcast() {}, getWorkingDir: () => '/tmp', isMultiSessionEnabled: () => false,
        importPipeline: async () => ({ orchestrate: async (_prompt: string, meta: Record<string, unknown>) => {
            assert.equal(meta.chatSessionId, 'captured-chat');
            activated = Boolean(activateSlackToolGrant(String(meta.requestId), String(meta.scope), String(meta.chatSessionId)));
        }, orchestrateContinue: async () => {}, orchestrateReset: async () => {}, isContinueIntent: () => false, isResetIntent: () => false, drainPendingReplays: async () => {} }),
    }, new SessionLanes(() => 1));
    try {
        const id = controller.enqueueMessage('queued Slack work', 'slack', { target, chatSessionId: activeChat, requestId: 'queue-request' });
        assert.equal(JSON.parse(persisted.get(id)!).chatSessionId, 'captured-chat');
        activeChat = 'unrelated-chat'; busy = false;
        await controller.processQueue('default');
        assert.equal(activated, true);
    } finally { revokeSlackToolScope(); }
});

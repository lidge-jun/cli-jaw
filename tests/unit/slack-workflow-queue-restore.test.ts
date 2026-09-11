import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createQueueController, type QueueDeps } from '../../src/agent/spawn/queue.ts';
import { SessionLanes } from '../../src/orchestrator/session-lanes.ts';
import type { SlackWorkflowMetadata } from '../../src/slack/workflow.ts';
import type { RemoteTarget } from '../../src/messaging/types.ts';

const target: RemoteTarget = { channel: 'slack', targetKind: 'channel', peerKind: 'group',
    targetId: 'C0EXAMPLE', threadId: '100.1', guildId: 'T0EXAMPLE' };
const workflow: SlackWorkflowMetadata = { skillId: 'example-workflow', skillSha256: 'a'.repeat(64),
    channelId: 'C0EXAMPLE', senderUserId: 'U0EXAMPLE', senderBotId: 'B0EXAMPLE',
    messageTs: '100.2', threadTs: '100.1', markers: ['EXAMPLE_READY_V1'] };

for (const multiSession of [false, true]) test(`workflow survives SQLite serialization, controller restart and drain (multiSession=${multiSession})`, async context => {
    context.mock.method(globalThis, 'fetch', async () => { assert.fail('Queue factory must not access the network'); });
    const database = new Database(':memory:');
    context.after(() => database.close());
    database.exec('CREATE TABLE queued_messages (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    let busy = true;
    const runs: Array<{ prompt: string; meta: Record<string, unknown> }> = [];
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const deps: QueueDeps = {
        migrateQueuedMessagesV1ToV2() {},
        isSpawnBusy: () => busy, hasBlockingWorkers: () => false, hasPendingWorkerReplays: () => false,
        insertMessage: { run() {} }, getActiveChatSession: () => 'default',
        insertQueuedMessage: database.prepare('INSERT OR REPLACE INTO queued_messages (id,payload) VALUES (?,?)'),
        deleteQueuedMessage: database.prepare('DELETE FROM queued_messages WHERE id = ?'),
        listQueuedMessages: { all: () => database.prepare('SELECT id,payload FROM queued_messages ORDER BY rowid').all() as Array<{ id: string; payload: string }> },
        broadcast: (type, data) => { events.push({ type, data }); },
        importPipeline: async () => ({
            orchestrate: async (prompt: string, meta: Record<string, unknown>) => { runs.push({ prompt, meta }); },
            orchestrateContinue: async () => { assert.fail('Unexpected continuation'); },
            orchestrateReset: async () => { assert.fail('Unexpected reset'); },
            isContinueIntent: () => false, isResetIntent: () => false, drainPendingReplays: async () => {},
        }),
        getWorkingDir: () => null, isMultiSessionEnabled: () => multiSession,
    };
    const before = createQueueController(deps, new SessionLanes(() => 1));
    const id = before.enqueueMessage('captured workflow prompt', 'slack', {
        target, scope: 'default', chatSessionId: 'default', requestId: 'example-workflow-request', slackWorkflow: workflow,
    });
    before.enqueueMessage('legacy Slack prompt', 'slack', { target, requestId: 'example-legacy-request' });
    before.enqueueMessage('human web prompt [SILENT]', 'web', { requestId: 'example-human-request' });
    const persisted = database.prepare('SELECT payload FROM queued_messages WHERE id = ?').pluck().get(id) as string;
    assert.deepEqual(JSON.parse(persisted).slackWorkflow, workflow);
    assert.equal(runs.length, 0);

    const restored = createQueueController(deps, new SessionLanes(() => 1));
    assert.equal(restored.messageQueue.length, 3);
    assert.deepEqual(restored.messageQueue[0]!.slackWorkflow, workflow);
    assert.equal(restored.messageQueue[1]!.slackWorkflow, undefined);
    assert.equal(restored.messageQueue[2]!.slackWorkflow, undefined);
    events.length = 0;
    busy = false;
    await restored.processQueue('default');
    for (let i = 0; i < 100 && (runs.length !== 3 || restored.isQueueBusy(null)); i++) {
        await new Promise<void>(resolve => setImmediate(resolve));
    }
    assert.deepEqual(runs.map(run => run.prompt), ['captured workflow prompt', 'legacy Slack prompt', 'human web prompt [SILENT]']);
    assert.deepEqual(runs[0]!.meta['slackWorkflow'], workflow);
    assert.equal(runs[0]!.meta['origin'], 'slack');
    assert.equal(runs[0]!.meta['requestId'], 'example-workflow-request');
    assert.equal(runs[0]!.meta['_fromQueue'], true);
    assert.equal(runs[1]!.meta['slackWorkflow'], undefined);
    assert.equal(runs[2]!.meta['slackWorkflow'], undefined);
    const started = events.filter(event => event.type === 'queued_run_started');
    assert.equal(started.length, 3);
    assert.deepEqual(started[0]!.data['slackWorkflow'], workflow);
    assert.equal(started[0]!.data['requestId'], 'example-workflow-request');
    assert.deepEqual(started[0]!.data['target'], target);
    assert.equal(started[1]!.data['slackWorkflow'], undefined);
    assert.equal(started[2]!.data['slackWorkflow'], undefined);
    assert.equal(restored.messageQueue.length, 0);
    assert.equal(database.prepare('SELECT count(*) FROM queued_messages').pluck().get(), 0);
});

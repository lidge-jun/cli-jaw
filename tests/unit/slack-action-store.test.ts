import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SlackActionStore, type ActionResource } from '../../src/slack/action-store.ts';

function fixture(t: { after(fn: () => void): void }) {
    const db = new Database(':memory:');
    t.after(() => db.close());
    return { db, store: new SlackActionStore(db) };
}
function resource(overrides: Partial<Omit<ActionResource, 'status'>> = {}): Omit<ActionResource, 'status'> {
    return { workspace: 'T1', actor: 'U1', channel: 'D1', botUserId: 'BOT1', credentialKey: 'hash1', kind: 'schedule', id: 'Q1', metadata: { payload: { text: 'prepared' }, postAt: 1900000000 }, ...overrides };
}

test('reservation rejects both duplicate and conflicting hashes without overwriting the original', t => {
    const { store } = fixture(t);
    assert.equal(store.invocation('T1', 'U1', 'I1'), undefined);
    assert.equal(store.reserve('T1', 'U1', 'I1', 'original'), true);
    assert.equal(store.reserve('T1', 'U1', 'I1', 'original'), false);
    assert.equal(store.reserve('T1', 'U1', 'I1', 'different'), false);
    assert.deepEqual(store.invocation('T1', 'U1', 'I1'), { request_hash: 'original', status: 'reserved', receipt_json: null });
    assert.equal(store.reserve('T2', 'U1', 'I1', 'other-workspace'), true);
    assert.equal(store.reserve('T1', 'U2', 'I1', 'other-actor'), true);
});
for (const status of ['completed', 'failed', 'unknown'] as const) test(`stores ${status} receipt for replay and prevents dispatch from reopening terminal state`, t => {
    const { db, store } = fixture(t);
    store.reserve('T1', 'U1', 'I1', 'hash'); store.dispatched('T1', 'U1', 'I1');
    assert.equal(store.invocation('T1', 'U1', 'I1')?.status, 'dispatched');
    const receipt = { ok: status === 'completed', retryable: false, resourceIds: ['Q1'], verification: status === 'completed' ? 'verified' : status };
    store.finish('T1', 'U1', 'I1', status, receipt);
    store.dispatched('T1', 'U1', 'I1');
    const reopened = new SlackActionStore(db);
    assert.deepEqual(reopened.invocation('T1', 'U1', 'I1'), { request_hash: 'hash', status, receipt_json: JSON.stringify(receipt) });
    assert.equal(reopened.reserve('T1', 'U1', 'I1', 'hash'), false);
    assert.equal(reopened.invocation('T1', 'U2', 'I1'), undefined);
});
test('receipt byte limit accepts exact boundary and rejects oversize without changing stored state', t => {
    const { store } = fixture(t); store.reserve('T1', 'U1', 'I1', 'hash');
    const exact = 'a'.repeat(16382);
    store.finish('T1', 'U1', 'I1', 'completed', exact);
    assert.equal(Buffer.byteLength(store.invocation('T1', 'U1', 'I1')!.receipt_json!), 16384);
    assert.throws(() => store.finish('T1', 'U1', 'I1', 'failed', '가'.repeat(6000)), /slack_action_receipt_too_large/);
    assert.equal(store.invocation('T1', 'U1', 'I1')?.status, 'completed');
});
test('invocation cap blocks new reservations but preserves existing receipts', t => {
    const { db, store } = fixture(t);
    db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000)
        INSERT INTO slack_tool_invocations SELECT 'T1','U1','I'||x,'h','completed','{}',0,0 FROM n`);
    assert.equal(store.reserve('T2', 'U2', 'new', 'h'), false);
    assert.deepEqual(store.invocation('T1', 'U1', 'I100000'), { request_hash: 'h', status: 'completed', receipt_json: '{}' });
});
for (const [field, value] of [['actor', 'U2'], ['channel', 'D2'], ['botUserId', 'BOT2'], ['credentialKey', 'hash2']] as const) test(`schedule ownership collision rejects changed ${field} and preserves metadata`, t => {
    const { store } = fixture(t); store.remember(resource());
    assert.throws(() => store.remember(resource({ [field]: value, metadata: { changed: true } })), /slack_action_resource_collision/);
    assert.deepEqual(store.resource('T1', 'schedule', 'Q1'), { ...resource(), status: 'active' });
});
test('resource identity and listing isolate workspace, kind, channel and actor', t => {
    const { store } = fixture(t);
    for (const row of [resource(), resource({ workspace: 'T2' }), resource({ kind: 'canvas' }), resource({ id: 'Q2', actor: 'U2' }), resource({ id: 'Q3', channel: 'D2' })]) store.remember(row);
    assert.deepEqual(store.resources('T1', 'schedule', 'D1', 'U1').map(r => r.id), ['Q1']);
    assert.deepEqual(store.resources('T1', 'schedule', 'D1').map(r => r.id).sort(), ['Q1', 'Q2']);
    assert.equal(store.resource('T3', 'schedule', 'Q1'), undefined);
    assert.equal(store.resource('T2', 'schedule', 'Q1')?.workspace, 'T2');
    assert.equal(store.resource('T1', 'canvas', 'Q1')?.kind, 'canvas');
});
test('retirement removes payload but retains immutable ownership and other resources', t => {
    const { store } = fixture(t); store.remember(resource()); store.remember(resource({ workspace: 'T2' }));
    store.retire('T1', 'schedule', 'Q1'); store.retire('T1', 'schedule', 'missing');
    assert.deepEqual(store.resource('T1', 'schedule', 'Q1'), { ...resource(), metadata: {}, status: 'retired' });
    assert.equal(store.resource('T2', 'schedule', 'Q1')?.status, 'active');
    assert.throws(() => store.remember(resource({ actor: 'U2' })), /slack_action_resource_collision/);
});
test('resource metadata byte cap rejects oversized UTF-8 without replacing a stored payload', t => {
    const { store } = fixture(t); store.remember(resource());
    assert.throws(() => store.remember(resource({ metadata: { text: '가'.repeat(90000) } })), /slack_action_resource_too_large/);
    assert.deepEqual(store.resource('T1', 'schedule', 'Q1')?.metadata, resource().metadata);
});
test('resource cap allows owned updates and retirement while rejecting new resources', t => {
    const { db, store } = fixture(t);
    db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000)
        INSERT INTO slack_tool_resources SELECT 'T1','schedule','Q'||x,'U1','D1','BOT1','hash1','active','{}' FROM n`);
    assert.throws(() => store.remember(resource({ id: 'new' })), /slack_action_resource_capacity/);
    store.remember(resource({ metadata: { updated: true } }));
    assert.deepEqual(store.resource('T1', 'schedule', 'Q1')?.metadata, { updated: true });
    store.retire('T1', 'schedule', 'Q1');
    assert.equal(store.resource('T1', 'schedule', 'Q1')?.status, 'retired');
    assert.throws(() => store.resources('T1', 'schedule', 'D1'), /slack_action_resource_list_incomplete/);
});
test('verified observations are scoped to workspace, credential and operation', t => {
    const { store } = fixture(t); assert.equal(store.verified('T1', 'hash1', 'schedule.create'), null);
    store.recordVerified('T1', 'hash1', 'schedule.create');
    assert.equal(typeof store.verified('T1', 'hash1', 'schedule.create'), 'number');
    for (const [workspace, key, op] of [['T2', 'hash1', 'schedule.create'], ['T1', 'hash2', 'schedule.create'], ['T1', 'hash1', 'schedule.cancel']]) assert.equal(store.verified(workspace!, key!, op!), null);
});
test('resource listing accepts 1000 scoped rows and fails closed at 1001 for actor and operator queries', t => {
    const { db, store } = fixture(t);
    db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000)
        INSERT INTO slack_tool_resources SELECT 'T1','schedule','Q'||x,'U1','D1','BOT1','hash1','active','{}' FROM n`);
    assert.equal(store.resources('T1', 'schedule', 'D1', 'U1').length, 1000);
    assert.equal(store.resources('T1', 'schedule', 'D1').length, 1000);
    store.remember(resource({ id: 'QEXTRA', actor: 'U2', credentialKey: 'old-key' }));
    assert.equal(store.resources('T1', 'schedule', 'D1', 'U1').length, 1000);
    assert.throws(() => store.resources('T1', 'schedule', 'D1'), /slack_action_resource_list_incomplete/);
    store.remember(resource({ id: 'QOWNEXTRA', credentialKey: 'old-key' }));
    assert.throws(() => store.resources('T1', 'schedule', 'D1', 'U1'), /slack_action_resource_list_incomplete/);
    assert.deepEqual(store.resources('T2', 'schedule', 'D1'), []);
    assert.deepEqual(store.resources('T1', 'schedule', 'D2'), []);
    assert.deepEqual(store.resources('T1', 'canvas', 'D1'), []);
});

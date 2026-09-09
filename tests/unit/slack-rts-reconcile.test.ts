import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { RtsOutputStore, configureRtsOutputStore, RTS_OUTPUT_MARKER } from '../../src/slack/rts-output-store.ts';
import { rtsActions } from '../../src/slack/actions-rts.ts';
import type { ActionContext } from '../../src/slack/action-types.ts';
import type { SlackApiResult } from '../../src/slack/api.ts';
import { publishSlackQuote } from '../../src/slack/quote.ts';
import { reserveSlackToolGrant, activateSlackToolGrant, resolveSlackToolGrant, revokeSlackToolScope, slackCredentialKey } from '../../src/slack/tool-context.ts';
import { resetVerifiedSlackWorkspace } from '../../src/slack/verified-workspace.ts';

const proofInput = { actor: 'U1', botUserId: 'UBOT', credentialKey: 'fixture-key', threadTs: '10.000000', expectedOutputs: 1 as const };
function fixture() {
    const db = new Database(':memory:'); const store = new RtsOutputStore(db); configureRtsOutputStore(store);
    const calls: Record<string, unknown>[] = [];
    const message = { ts: '20.000001', thread_ts: '10.000000', user: 'UBOT', text: 'PRIVATE_CANARY', blocks: [{ type: 'rich_text', block_id: `${RTS_OUTPUT_MARKER}:inv1`, elements: [] }] };
    const pages: SlackApiResult[] = [{ ok: true, data: { messages: [message], has_more: false, response_metadata: { next_cursor: '' } } }];
    const ctx: ActionContext = {
        token: 'context-fixture', workspace: 'T1', botUserId: 'UBOT', actor: 'U1', channel: 'D1', credentialKey: 'fixture-key', operator: false,
        checkCurrent() {}, now: () => 1800000000000,
        async api<T>(method: string, body: Record<string, unknown>) { assert.ok(rtsActions[0]!.methods.includes(method)); calls.push({ method, ...body }); return pages.shift() as SlackApiResult<T>; },
        remember() { throw new Error('must use RTS store'); }, resource() { return undefined; }, resources() { return []; }, retire() { throw new Error('unexpected'); },
        async download() { throw new Error('unexpected'); },
        result(verification, data, resourceIds = []) { return { ok: verification !== 'failed', operation: 'rts.reconcile', verification, data, resourceIds, retryable: false }; },
        fail(error, status, resourceIds = []) { return { ok: false, operation: 'rts.reconcile', verification: 'failed', error, status, resourceIds, retryable: false }; },
    };
    const begin = (terminal = true) => { assert.ok(store.begin('T1', 'D1', 'inv1', proofInput)); const proof = store.publication('T1', 'D1', 'inv1')!; if (terminal) store.terminal('T1', 'D1', 'inv1', proof.lease, [], false); };
    const run = (args: Record<string, unknown> = {}) => rtsActions[0]!.prepare({ operation: 'rts.reconcile', channel: 'D1', invocationId: 'inv1', threadTs: '10.000000', ...args }).execute(ctx);
    return { db, store, ctx, calls, pages, message, begin, run, close() { configureRtsOutputStore(undefined); db.close(); } };
}
test('terminal exact-scope count-complete marker registers ID and clears only its hold', async () => {
    const f = fixture(); try {
        f.begin(); f.store.begin('T1', 'D1', 'other', proofInput);
        const result = await f.run(); assert.equal(result.verification, 'verified');
        assert.deepEqual(result.resourceIds, ['20.000001']); assert.equal(JSON.stringify(result).includes('PRIVATE_CANARY'), false);
        assert.equal(f.store.contains('T1', 'D1', '20.000001'), true); assert.equal(f.store.held('T1', 'D1'), true);
        assert.equal(f.store.publication('T1', 'D1', 'inv1')!.state, 'reconciled');
        assert.equal(f.store.begin('T1', 'D1', 'inv1', proofInput), false);
        assert.deepEqual(f.calls[0], { method: 'conversations.replies', channel: 'D1', ts: '10.000000', limit: 100 });
    } finally { f.close(); }
});
for (const mode of ['active', 'legacy', 'restart-active', 'thread', 'actor', 'credential', 'bot']) {
    test(`unproven ${mode} cannot reconcile even with an exact marker`, async () => {
        const f = fixture(); try {
            if (mode === 'legacy') f.store.begin('T1', 'D1', 'inv1'); else f.begin(!['active', 'restart-active'].includes(mode));
            if (mode === 'restart-active') configureRtsOutputStore(new RtsOutputStore(f.db));
            if (mode === 'actor') Object.assign(f.ctx, { actor: 'UOTHER' });
            if (mode === 'credential') Object.assign(f.ctx, { credentialKey: 'other' });
            if (mode === 'bot') Object.assign(f.ctx, { botUserId: 'UOTHER' });
            const result = await f.run(mode === 'thread' ? { threadTs: '99.000000' } : {});
            assert.equal(result.ok, false); assert.equal(f.calls.length, 0); assert.equal(f.store.held('T1', 'D1'), true);
        } finally { f.close(); }
    });
}
for (const mode of ['missing', 'extra', 'wrong-author', 'wrong-thread', 'prefix-marker', 'has-more', 'no-completeness', 'error', 'excluded', 'duplicate']) {
    test(`scan ${mode} retains the hold`, async () => {
        const f = fixture(); try {
            f.begin(); const data = f.pages[0]!.data!;
            if (mode === 'missing') data['messages'] = [];
            if (mode === 'extra') data['messages'] = [f.message, { ...f.message, ts: '20.000002' }];
            if (mode === 'wrong-author') f.message.user = 'UOTHER';
            if (mode === 'wrong-thread') f.message.thread_ts = '11.000000';
            if (mode === 'prefix-marker') f.message.blocks[0]!.block_id += 'suffix';
            if (mode === 'has-more') { data['has_more'] = true; data['response_metadata'] = { next_cursor: 'next' }; }
            if (mode === 'no-completeness') delete data['has_more'];
            if (mode === 'error') f.pages[0] = { ok: false, error: 'ratelimited' };
            if (mode === 'excluded') Object.assign(f.message, { contentExcluded: true });
            if (mode === 'duplicate') data['messages'] = [f.message, f.message];
            const result = await f.run({ maxPages: 1 });
            assert.notEqual(result.verification, 'verified'); assert.equal(f.store.held('T1', 'D1'), true);
            assert.equal(f.store.contains('T1', 'D1', '20.000001'), false); assert.equal(JSON.stringify(result).includes('PRIVATE_CANARY'), false);
        } finally { f.close(); }
    });
}
test('full pagination preserves exact scope and repeated cursor is incomplete', async () => {
    const f = fixture(); try {
        f.begin(); f.pages.unshift({ ok: true, data: { messages: [], has_more: true, response_metadata: { next_cursor: 'next' } } });
        assert.equal((await f.run()).verification, 'verified'); assert.equal(f.calls[1]!['cursor'], 'next');
    } finally { f.close(); }
});
test('legacy schema upgrade and finish cannot silently delete unproven holds', () => {
    const db = new Database(':memory:');
    db.exec("CREATE TABLE slack_rts_holds(workspace TEXT,destination TEXT,invocation_id TEXT,PRIMARY KEY(workspace,destination,invocation_id)); INSERT INTO slack_rts_holds VALUES('T1','D1','legacy')");
    const store = new RtsOutputStore(db);
    try { store.finish('T1', 'D1', 'legacy'); assert.equal(store.held('T1', 'D1'), true); assert.equal(store.publication('T1', 'D1', 'legacy'), undefined); }
    finally { db.close(); }
});
test('lease mismatch and known output conflict cannot clear hold', () => {
    const f = fixture(); try {
        f.begin(false); const proof = f.store.publication('T1', 'D1', 'inv1')!;
        assert.throws(() => f.store.terminal('T1', 'D1', 'inv1', 'wrong', [], true));
        f.store.terminal('T1', 'D1', 'inv1', proof.lease, ['20.000001'], false);
        assert.equal(f.store.reconcile('T1', 'D1', 'inv1', proof.lease, ['20.000002']), false);
        assert.equal(f.store.held('T1', 'D1'), true);
    } finally { f.close(); }
});
test('operator can reconcile bound destination but cannot narrow root scope to a thread', async () => {
    const f = fixture(); try { f.begin(); Object.assign(f.ctx, { operator: true, actor: 'operator' }); assert.equal((await f.run()).verification, 'verified'); }
    finally { f.close(); }
    const g = fixture(); try {
        g.store.begin('T1', 'D1', 'inv1', { ...proofInput, threadTs: null }); const p = g.store.publication('T1', 'D1', 'inv1')!;
        g.store.terminal('T1', 'D1', 'inv1', p.lease, [], false);
        assert.equal((await g.run()).error, 'slack_rts_scope_mismatch'); assert.equal(g.calls.length, 0);
    } finally { g.close(); }
});

function publishingFixture(mode: 'success' | '429' | 'timeout' | 'mismatch' | 'duplicate') {
    const posts: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
        const method = String(url).split('/').at(-1)!; const raw = String(init?.body ?? '');
        const body = raw.startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
        let data: Record<string, unknown> = {};
        if (method === 'auth.test') data = { team_id: 'T1', user_id: 'UBOT' };
        else if (method === 'conversations.info') data = { channel: { id: body.channel, is_shared: false, is_ext_shared: false, context_team_id: 'T1' } };
        else if (method === 'users.info') data = { user: { id: 'U2', name: 'Author', team_id: 'T1' } };
        else if (method === 'conversations.members') data = { members: ['U1', 'U2', 'UBOT'], response_metadata: { next_cursor: '' } };
        else if (method === 'chat.getPermalink') data = { permalink: 'https://example.slack.com/archives/C1/p1000000' };
        else if (method === 'chat.postMessage') {
            posts.push(body);
            if (mode === '429') return new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), { status: 429, headers: { 'retry-after': '0.001' } });
            if (mode === 'timeout') throw new Error('PRIVATE_CANARY');
            data = { ts: '20.000001' };
        } else if (method === 'conversations.history' || method === 'conversations.replies') {
            data = body.channel === 'C1' ? { messages: [{ ts: '1.000000', user: 'U2', text: 'PRIVATE_CANARY' }], response_metadata: { next_cursor: '' } }
                : { messages: [{ ts: '20.000001', user: 'UBOT', blocks: mode === 'mismatch' ? [] : posts[0]?.['blocks'] }], response_metadata: { next_cursor: '' } };
            if (body.channel === 'C2' && mode === 'duplicate') (data['messages'] as unknown[]).push({ ts: '20.000001', user: 'UBOT', blocks: [] });
        } else throw new Error(`unexpected ${method}`);
        return new Response(JSON.stringify({ ok: true, ...data }));
    };
    return { fetchImpl, posts };
}
for (const mode of ['success', '429', 'timeout', 'mismatch', 'duplicate', 'oversize'] as const) {
    test(`RTS publisher ${mode}: exactly one POST and durable terminal evidence`, async () => {
        revokeSlackToolScope(); resetVerifiedSlackWorkspace();
        const db = new Database(':memory:'); const store = new RtsOutputStore(db); configureRtsOutputStore(store);
        const token = 'fixture-token';
        reserveSlackToolGrant({ teamId: 'T1', actorId: 'U1', credentialKey: slackCredentialKey(token), destination: { channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'C2' } }, { requestId: 'r1', scope: 's1', chatSessionId: 'c1' });
        const secret = activateSlackToolGrant('r1', 's1', 'c1')!; const principal = { kind: 'turn' as const, grant: resolveSlackToolGrant(secret)! };
        try {
            const fake = publishingFixture(mode === 'oversize' ? 'success' : mode);
            if (mode === 'oversize') {
                await assert.rejects(publishSlackQuote(token, principal, { source: { channel: 'C1', ts: '1.000000' }, summary: 'x'.repeat(9001) }, { fetchImpl: fake.fetchImpl }, 'inv1'), /single_payload/);
                assert.equal(fake.posts.length, 0); assert.equal(store.held('T1', 'C2'), false); return;
            }
            const result = await publishSlackQuote(token, principal, { source: { channel: 'C1', ts: '1.000000' } }, { fetchImpl: fake.fetchImpl }, 'inv1');
            assert.equal(fake.posts.length, 1); assert.equal(result.ok, mode === 'success');
            const proof = store.publication('T1', 'C2', 'inv1')!;
            assert.equal(proof.expectedOutputs, 1); assert.equal(proof.threadTs, null); assert.ok(proof.terminalAt);
            assert.equal(proof.state, mode === 'success' ? 'reconciled' : 'terminal');
            assert.equal(store.held('T1', 'C2'), mode !== 'success');
            assert.equal(JSON.stringify(proof).includes('PRIVATE_CANARY'), false);
        } finally { revokeSlackToolScope(); configureRtsOutputStore(undefined); db.close(); }
    });
}

test('cursor cycle and cancelled reconciliation keep durable hold', async () => {
    for (const cancel of [false, true]) {
        const f = fixture(); try {
            f.begin();
            f.pages.splice(0, 1, ...Array.from({ length: 2 }, () => ({ ok: true, data: { messages: [], has_more: true, response_metadata: { next_cursor: 'same' } } })));
            if (cancel) { let checks = 0; f.ctx.checkCurrent = () => { if (++checks > 1) throw new Error('fixture cancelled'); }; }
            const result = await f.run(); assert.notEqual(result.verification, 'verified'); assert.equal(f.store.held('T1', 'D1'), true);
            assert.ok(f.calls.length <= 2);
        } finally { f.close(); }
    }
});
test('reconcile input has no caller-controlled range or method proxy', () => {
    for (const extra of [{ oldest: '1.0' }, { latest: '2.0' }, { method: 'chat.postMessage' }, { maxPages: 11 }, { threadTs: 'invalid' }]) {
        assert.throws(() => rtsActions[0]!.prepare({ operation: 'rts.reconcile', channel: 'D1', invocationId: 'inv1', ...extra }));
    }
});

test('registration failure rolls back hold clearance', async t => {
    const f = fixture(); try {
        f.begin(); t.mock.method(f.store, 'record', () => { throw new Error('fixture capacity'); });
        const result = await f.run(); assert.equal(result.verification, 'unknown');
        assert.equal(f.store.held('T1', 'D1'), true); assert.equal(f.store.publication('T1', 'D1', 'inv1')!.state, 'terminal');
    } finally { f.close(); }
});


test('publication capacity denies new proofs independently of output count', () => {
    const f = fixture(); try {
        f.db.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100000)
            INSERT INTO slack_rts_publications SELECT 'T1','D1','old'||x,'{}' FROM n`);
        assert.equal(f.store.begin('T1', 'D1', 'inv1', proofInput), false);
        assert.equal(f.store.held('T1', 'D1'), false);
        assert.equal((f.db.prepare('SELECT count(*) AS n FROM slack_rts_outputs').get() as { n: number }).n, 0);
    } finally { f.close(); }
});
test('reconcile has no unrelated fixed scope gate', () => { assert.deepEqual(rtsActions[0]!.scopes, []); });
test('ordinary source quote rejects duplicate same-timestamp readback', async () => {
    resetVerifiedSlackWorkspace(); configureRtsOutputStore(undefined);
    const fake = publishingFixture('duplicate');
    const result = await publishSlackQuote('fixture-token', { kind: 'operator' }, {
        source: { channel: 'C1', ts: '1.000000' },
        destination: { channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'C2' },
    }, { fetchImpl: fake.fetchImpl });
    assert.equal(result.ok, false); assert.equal(result.contentVerification, 'failed'); assert.equal(fake.posts.length, 1);
});

test('two concurrent reconcilers cannot both clear the same publication', async () => {
    const f = fixture(); try {
        f.begin(); f.pages.push(structuredClone(f.pages[0]!));
        const results = await Promise.all([f.run(), f.run()]);
        assert.equal(results.filter(r => r.verification === 'verified').length, 1);
        assert.equal(f.store.held('T1', 'D1'), false);
        assert.equal((f.db.prepare('SELECT count(*) AS n FROM slack_rts_outputs').get() as { n: number }).n, 1);
    } finally { f.close(); }
});
test('terminal evidence is immutable even to the original publisher lease', () => {
    const f = fixture(); try {
        f.begin(); const proof = f.store.publication('T1', 'D1', 'inv1')!;
        assert.throws(() => f.store.terminal('T1', 'D1', 'inv1', proof.lease, ['20.000002'], true), /not_owned/);
        assert.deepEqual(f.store.publication('T1', 'D1', 'inv1'), proof);
    } finally { f.close(); }
});

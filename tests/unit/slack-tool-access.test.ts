import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reserveSlackToolGrant, activateSlackToolGrant, resolveSlackToolGrant, revokeSlackToolGrant, revokeSlackToolScope,
    slackCredentialKey, createSlackToolSecretStream } from '../../src/slack/tool-context.ts';
import { resolveSlackToolPrincipal, withSlackToolAccess } from '../../src/slack/tool-access.ts';
import { initializeSlackOperatorAuth, SLACK_OPERATOR_TOKEN_FILE } from '../../src/slack/operator-auth.ts';
import { resetVerifiedSlackWorkspace } from '../../src/slack/verified-workspace.ts';
const token = 'fixture-bot-token';
const destination = { channel: 'slack' as const, targetKind: 'channel' as const, peerKind: 'direct' as const, targetId: 'D1', threadId: '1.0' };
function grant(id = 'request', scope = 'scope') {
    assert.ok(reserveSlackToolGrant({ teamId: 'T1', actorId: 'U1', destination, credentialKey: slackCredentialKey(token) }, { requestId: id, scope, chatSessionId: 'chat' }));
    const secret = activateSlackToolGrant(id, scope, 'chat'); assert.ok(secret);
    const value = resolveSlackToolGrant(secret); assert.ok(value);
    return { secret, value };
}
test.beforeEach(() => { revokeSlackToolScope(); resetVerifiedSlackWorkspace(); });

test('grants activate only for captured request scope/session and revoke independently', () => {
    reserveSlackToolGrant({ teamId: 'T1', actorId: 'U1', destination, credentialKey: slackCredentialKey(token) }, { requestId: 'old', scope: 's', chatSessionId: 'c' });
    assert.equal(activateSlackToolGrant('old', 'wrong', 'c'), undefined);
    const old = activateSlackToolGrant('old', 's', 'c')!;
    assert.equal(activateSlackToolGrant('old', 's', 'c'), undefined);
    const newer = grant('new');
    revokeSlackToolGrant('old');
    assert.equal(resolveSlackToolGrant(old), null);
    assert.equal(resolveSlackToolGrant(newer.secret), newer.value);
    revokeSlackToolScope('scope'); assert.equal(newer.value.signal.aborted, true);
});

test('grant expiry aborts retained handles and prevents reuse', t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const { secret, value } = grant();
    t.mock.timers.tick(15 * 60_000);
    assert.equal(resolveSlackToolGrant(secret), null); assert.equal(value.signal.aborted, true);
});

test('operator token is separate, private and stable across initialization', t => {
    const home = mkdtempSync(join(tmpdir(), 'slack-operator-')); t.after(() => rmSync(home, { recursive: true, force: true }));
    const validate = initializeSlackOperatorAuth(home);
    const secret = readFileSync(join(home, SLACK_OPERATOR_TOKEN_FILE), 'utf8').trim();
    assert.ok(validate(secret)); assert.ok(initializeSlackOperatorAuth(home)(secret));
    if (process.platform !== 'win32') assert.equal(statSync(join(home, SLACK_OPERATOR_TOKEN_FILE)).mode & 0o777, 0o600);
    assert.throws(() => resolveSlackToolPrincipal({ authorization: 'Bearer ordinary-http-token', 'x-jaw-slack-operator': 'true' }, validate), /grant_required/);
    assert.deepEqual(resolveSlackToolPrincipal({ 'x-jaw-slack-operator': secret }, validate), { kind: 'operator' });
    assert.throws(() => resolveSlackToolPrincipal({}, validate), /grant_required/);
});

function fixture(options: { actorMissing?: boolean; incomplete?: boolean; shared?: boolean; workspace?: string; destinationExtra?: boolean } = {}) {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
        const method = new URL(String(url)).pathname.split('/').at(-1)!; calls.push(method);
        const body = new URLSearchParams(String(init?.body));
        let data: Record<string, unknown>;
        if (method === 'auth.test') data = { team_id: options.workspace ?? 'T1', user_id: 'UBOT' };
        else if (method === 'conversations.info') data = { channel: { id: body.get('channel'), is_shared: options.shared ?? false, is_ext_shared: false, context_team_id: 'T1' } };
        else if (method === 'conversations.members') data = { members: options.actorMissing ? ['UBOT'] : ['U1', 'UBOT', ...(options.destinationExtra && body.get('channel') === 'D1' ? ['UOTHER'] : [])], response_metadata: { next_cursor: options.incomplete ? 'repeat' : '' } };
        else throw new Error('unexpected method');
        return new Response(JSON.stringify({ ok: true, ...data }));
    };
    return { fetchImpl, calls };
}

test('membership permits current conversation but rejects missing actor, partial list, shared conversation and wrong workspace before content', async () => {
    for (const options of [{}, { actorMissing: true }, { incomplete: true }, { shared: true }, { workspace: 'T2' }]) {
        revokeSlackToolScope(); resetVerifiedSlackWorkspace();
        const { value } = grant(); const { fetchImpl } = fixture(options); let contentCalls = 0;
        const result = withSlackToolAccess(token, { kind: 'turn', grant: value }, 'D1', async () => { contentCalls++; return 'content'; }, fetchImpl);
        if (Object.keys(options).length) { await assert.rejects(result); assert.equal(contentCalls, 0); }
        else { assert.equal(await result, 'content'); assert.equal(contentCalls, 1); }
    }
});

test('cross-conversation disclosure requires all destination members in source', async () => {
    const { value } = grant(); const { fetchImpl } = fixture({ destinationExtra: true });
    let writes = 0;
    await assert.rejects(withSlackToolAccess(token, { kind: 'turn', grant: value }, 'C1', async () => { writes++; }, fetchImpl), /disclosure_denied/);
    assert.equal(writes, 0);
});

test('cancelled read cannot return content, cancelled write preserves its receipt', async () => {
    const { value } = grant(); const { fetchImpl } = fixture();
    await assert.rejects(withSlackToolAccess(token, { kind: 'turn', grant: value }, 'D1', async () => { revokeSlackToolGrant('request'); return 'secret content'; }, fetchImpl), /expired/);
    const second = grant('second');
    const receipt = await withSlackToolAccess(token, { kind: 'turn', grant: second.value }, 'D1', async () => { revokeSlackToolGrant('second'); return { ts: '2.0', ok: true }; }, fetchImpl,
        result => ({ ...result, ok: false }));
    assert.deepEqual(receipt, { ts: '2.0', ok: false });
});

test('credential stream redacts secrets across all chunk split positions', () => {
    const { secret } = grant();
    for (let split = 0; split <= secret.length; split++) {
        const stream = createSlackToolSecretStream();
        const output = stream(secret.slice(0, split)) + stream(secret.slice(split) + '\n') + stream('', true);
        assert.ok(!output.includes(secret)); assert.match(output, /REDACTED/);
    }
});

test('request settlement revokes grants even after registry settlement', async () => {
    const { admitRequest, settleOnce } = await import('../../src/orchestrator/request-registry.ts');
    const { value, secret } = grant('settlement');
    admitRequest('settlement', 'scope');
    settleOnce('settlement', 'cancelled');
    assert.equal(value.signal.aborted, true); assert.equal(resolveSlackToolGrant(secret), null);
});

test('all legacy Slack HTTP paths deny missing grants and ordinary instance bearer', async t => {
    const { settings } = await import('../../src/core/config.ts');
    const { registerMessagingRoutes } = await import('../../src/routes/messaging.ts');
    const oldSlack = settings.slack; const oldHome = settings.messaging.homeChannel;
    settings.slack = { ...oldSlack, enabled: true, botToken: token }; settings.messaging.homeChannel = 'slack';
    t.after(() => { settings.slack = oldSlack; settings.messaging.homeChannel = oldHome; });
    const oldFetch = globalThis.fetch; let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('must not call Slack'); };
    t.after(() => { globalThis.fetch = oldFetch; });
    const handlers = new Map<string, (req: unknown, res: unknown) => Promise<void>>();
    const register = (path: string, ...fns: Array<(req: unknown, res: unknown) => Promise<void>>) => { handlers.set(path, fns.at(-1)!); };
    registerMessagingRoutes({ get: register, post: register, use() {} } as never, ((_req: unknown, _res: unknown, next: () => void) => next()) as never);
    for (const path of ['/api/slack/history', '/api/slack/members', '/api/slack/users', '/api/slack/send', '/api/channel/send']) {
        let status = 200;
        const res = { status(code: number) { status = code; return res; }, json() {} };
        await handlers.get(path)!({ query: { channel: 'D1' }, headers: { authorization: 'Bearer ordinary-http-token', 'x-jaw-slack-operator': 'true' }, body: { type: 'text', text: 'not sent' } }, res);
        assert.equal(status, 401, path);
    }
    assert.equal(calls, 0);
});

test('missing security metadata never admits protected content', async () => {
    const { value } = grant(); let invoked = false;
    const fetchImpl: typeof fetch = async url => new Response(JSON.stringify(String(url).endsWith('auth.test')
        ? { ok: true, team_id: 'T1', user_id: 'UBOT' }
        : { ok: true, channel: { id: 'D1' }, members: ['U1', 'UBOT'] }));
    await assert.rejects(withSlackToolAccess(token, { kind: 'turn', grant: value }, 'D1', async () => { invoked = true; }, fetchImpl), /conversation_unverified/);
    assert.equal(invoked, false);
});

test('Slack send refuses credential rebinding and stops split keyboard fallback on abort', async t => {
    const { settings } = await import('../../src/core/config.ts');
    const { slackSendHandler } = await import('../../src/slack/send-handler.ts');
    const saved = settings.slack; const originalFetch = globalThis.fetch;
    t.after(() => { settings.slack = saved; globalThis.fetch = originalFetch; });
    settings.slack = { ...saved, enabled: true, botToken: 'credential-B' };
    let posts = 0; const controller = new AbortController();
    globalThis.fetch = async () => { posts++; controller.abort(); return new Response(JSON.stringify({ ok: true, ts: '2.0' })); };
    const stale = await slackSendHandler({ type: 'text', target: destination, text: 'never sent', slackCredentialKey: slackCredentialKey('credential-A') });
    assert.equal(stale.ok, false); assert.equal(posts, 0);
    const result = await slackSendHandler({ type: 'keyboard', target: destination, text: 'a'.repeat(50000), interactiveFallback: 'text', signal: controller.signal });
    assert.equal(result.ok, false); assert.equal(posts, 1);
});

test('documented DM metadata requires actor workspace and exact two-person membership', async () => {
    for (const actorTeam of ['T1', 'OTHER']) {
        revokeSlackToolScope(); resetVerifiedSlackWorkspace();
        const { value } = grant(); let calls = 0;
        const fetchImpl: typeof fetch = async url => {
            const method = String(url).split('/').at(-1);
            const data = method === 'auth.test' ? { team_id: 'T1', user_id: 'UBOT' }
                : method === 'conversations.info' ? { channel: { id: 'D1', is_im: true, is_org_shared: false, user: 'U1' } }
                : method === 'users.info' ? { user: { id: 'U1', team_id: actorTeam } }
                : { members: ['U1', 'UBOT'], response_metadata: { next_cursor: '' } };
            return new Response(JSON.stringify({ ok: true, ...data }));
        };
        const result = withSlackToolAccess(token, { kind: 'turn', grant: value }, 'D1', async () => { calls++; return true; }, fetchImpl);
        if (actorTeam === 'T1') { assert.equal(await result, true); assert.equal(calls, 1); }
        else { await assert.rejects(result, /workspace_unverified/); assert.equal(calls, 0); }
    }
});

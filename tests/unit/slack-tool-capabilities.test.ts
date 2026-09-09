import '../setup/isolated-home.ts';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { slackToolCapabilities } from '../../src/slack/tool-capabilities.ts';
import { slackActions } from '../../src/slack/actions.ts';
import { SlackActionStore } from '../../src/slack/action-store.ts';
import { SlackActionRuntime } from '../../src/slack/action-runtime.ts';
import { SlackActionRateLimiter } from '../../src/slack/action-rate.ts';
import { configureRtsOutputStore, RtsOutputStore } from '../../src/slack/rts-output-store.ts';
import { resetVerifiedSlackWorkspace } from '../../src/slack/verified-workspace.ts';
import { reserveSlackToolGrant, activateSlackToolGrant, resolveSlackToolGrant, revokeSlackToolScope, slackCredentialKey } from '../../src/slack/tool-context.ts';
import type { SlackToolPrincipal } from '../../src/slack/tool-access.ts';
import type { ActionDefinition } from '../../src/slack/action-types.ts';

const TOKEN = 'capability-fixture';
const operator: SlackToolPrincipal = { kind: 'operator' };
// A caller-provided definition tests the catalog's inbound contract independently
// of the interaction worker's changing implementation/registration surface.
const inbound: ActionDefinition = { operation: 'fixture.interaction', scopes: ['chat:write'], methods: [], mutates: true,
    requiresInbound: true, prepare() { throw new Error('Catalog must not execute definitions'); } };
const definitions = [...slackActions, inbound];
type Catalog = Awaited<ReturnType<typeof slackToolCapabilities>>;
function entry(catalog: Catalog, operation: string) {
    const found = catalog.capabilities.find(item => item.operation === operation); assert.ok(found); return found;
}
function fixture(t: TestContext, scopes?: string) {
    resetVerifiedSlackWorkspace(); revokeSlackToolScope();
    const db = new Database(':memory:'); const store = new SlackActionStore(db);
    configureRtsOutputStore(new RtsOutputStore(db));
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async url => {
        const method = String(url).split('/').at(-1)!; calls.push(method);
        assert.ok(['auth.test', 'reactions.get'].includes(method));
        return new Response(JSON.stringify({ ok: true, ...(method === 'auth.test' ? { team_id: 'T1', user_id: 'UBOT' }
            : { type: 'message', message: { ts: '1.000000', reactions: [] } }) }),
        { headers: scopes === undefined ? {} : { 'x-oauth-scopes': scopes } });
    };
    t.after(() => { configureRtsOutputStore(undefined); revokeSlackToolScope(); resetVerifiedSlackWorkspace(); db.close(); });
    return { store, calls, fetchImpl,
        catalog(principal: SlackToolPrincipal | null = operator, inboundReady = false, token: string | null = TOKEN) {
            return slackToolCapabilities(token, definitions, principal, store, { fetchImpl, inboundReady });
        },
        turn(actionToken?: string): SlackToolPrincipal {
            const id = actionToken ? 'with-action' : 'without-action';
            assert.ok(reserveSlackToolGrant({ teamId: 'T1', actorId: 'U1', credentialKey: slackCredentialKey(TOKEN),
                destination: { channel: 'slack', targetId: 'D1', targetKind: 'user', peerKind: 'direct' },
                ...(actionToken ? { actionToken } : {}) }, { requestId: id, scope: 'default', chatSessionId: 'chat' }));
            const secret = activateSlackToolGrant(id, 'default', 'chat'); assert.ok(secret);
            const grant = resolveSlackToolGrant(secret); assert.ok(grant); return { kind: 'turn', grant };
        } };
}

test('unknown scopes remain unknown, not missing or verified', async t => {
    const f = fixture(t); const catalog = await f.catalog(); const action = entry(catalog, 'reaction.get');
    assert.equal(catalog.scopesKnown, false); assert.equal(action.implemented, true);
    assert.equal(action.granted, null); assert.deepEqual(action.missingScopes, []);
    assert.equal(action.available, false); assert.equal(action.reason, 'scopes_unverified'); assert.equal(action.verified, false);
    const raw = entry(catalog, 'search.raw');
    assert.equal(raw.implemented, false); assert.equal(raw.available, false); assert.equal(raw.reason, 'retention_path_unverified');
    assert.equal(entry(catalog, 'modal.open').implemented, false);
    const message = entry(catalog, 'message');
    assert.deepEqual(message.requiredScopes, []); assert.equal(message.granted, true);
    assert.equal(message.resourceChecksRequired, true); assert.equal(message.verified, false);
    assert.deepEqual(f.calls, ['auth.test']);
});

test('stale signal, expiry, workspace and credential each make a granted implementation unavailable', async t => {
    const f = fixture(t, 'reactions:read,im:read,users:read'); const principal = f.turn(); assert.equal(principal.kind, 'turn');
    if (principal.kind !== 'turn') throw new Error('Expected fixture turn');
    const controller = new AbortController(); controller.abort();
    const variants = [
        { signal: controller.signal }, { expiresAt: Date.now() - 1 },
        { teamId: 'TOTHER' }, { credentialKey: slackCredentialKey('other-fixture-token') },
    ];
    for (const change of variants) {
        const item = entry(await f.catalog({ kind: 'turn', grant: { ...principal.grant, ...change } }), 'reaction.get');
        assert.equal(item.implemented, true); assert.equal(item.granted, true);
        assert.equal(item.available, false); assert.equal(item.reason, 'turn_grant_stale');
        assert.equal(item.verified, false);
    }
});

test('known non-DM resource turn is unavailable without changing scope grants or operator authority', async t => {
    const f = fixture(t, 'files:read,users:read,lists:read,im:read'); const principal = f.turn();
    if (principal.kind !== 'turn') throw new Error('Expected fixture turn');
    const group: SlackToolPrincipal = { kind: 'turn', grant: { ...principal.grant,
        destination: { ...principal.grant.destination, targetId: 'C1', targetKind: 'channel', peerKind: 'channel' } } };
    for (const operation of ['canvas.read', 'list.read']) {
        const unavailable = entry(await f.catalog(group), operation);
        assert.equal(unavailable.granted, true); assert.equal(unavailable.available, false);
        assert.equal(unavailable.reason, 'requester_dm_required');
        const dm = entry(await f.catalog(principal), operation);
        assert.equal(dm.available, true); assert.equal(dm.resourceChecksRequired, true); assert.equal(dm.verified, false);
        assert.equal(entry(await f.catalog(operator), operation).available, true);
    }
});

test('known missing scopes differ from granted-but-unverified availability', async t => {
    const f = fixture(t, 'reactions:read'); const catalog = await f.catalog();
    assert.equal(catalog.scopesKnown, true);
    const read = entry(catalog, 'reaction.get');
    assert.equal(read.granted, true); assert.equal(read.available, true); assert.equal(read.verified, false); assert.equal(read.verifiedAt, null);
    const write = entry(catalog, 'reaction.add');
    assert.equal(write.granted, false); assert.deepEqual(write.missingScopes, ['reactions:write']);
    assert.equal(write.available, false); assert.equal(write.reason, 'missing_scope');
});

test('missing token and missing principal have distinct unavailable reasons', async t => {
    const f = fixture(t, 'reactions:read');
    const absent = entry(await f.catalog(operator, false, null), 'reaction.get');
    assert.equal(absent.granted, null); assert.equal(absent.reason, 'slack_unavailable'); assert.deepEqual(f.calls, []);
    const anonymous = entry(await f.catalog(null), 'reaction.get');
    assert.equal(anonymous.granted, true); assert.equal(anonymous.available, false); assert.equal(anonymous.reason, 'turn_authorization_unavailable');
});

test('action-token, privacy-store and inbound readiness independently gate granted implementations', async t => {
    const f = fixture(t, 'search:read.public,chat:write,im:read,users:read');
    assert.equal(entry(await f.catalog(operator), 'search.quote').reason, 'action_token_unavailable');
    assert.equal(entry(await f.catalog(f.turn()), 'search.quote').reason, 'action_token_unavailable');
    const turn = f.turn('action-fixture');
    const ready = entry(await f.catalog(turn), 'search.quote');
    assert.equal(ready.implemented, true); assert.equal(ready.granted, true); assert.equal(ready.available, true); assert.equal(ready.verified, false);
    configureRtsOutputStore(null);
    assert.equal(entry(await f.catalog(turn), 'search.quote').reason, 'privacy_store_unavailable');
    const offline = entry(await f.catalog(operator, false), inbound.operation);
    assert.equal(offline.granted, true); assert.equal(offline.available, false); assert.equal(offline.reason, 'inbound_unavailable');
    assert.equal(entry(await f.catalog(operator, true), inbound.operation).available, true);
});

test('fixture runtime proof never becomes real verified; historical proof stays separate from availability', async t => {
    const f = fixture(t, 'reactions:read,chat:write');
    const runtime = new SlackActionRuntime({ getToken: () => TOKEN, store: f.store, fetchImpl: f.fetchImpl,
        evidenceSource: 'fixture', rateLimiter: new SlackActionRateLimiter() });
    const definition = slackActions.find(item => item.operation === 'reaction.get'); assert.ok(definition);
    const result = await runtime.execute(definition, { operation: 'reaction.get', channel: 'C1', ts: '1.000000' }, operator);
    assert.equal(result.verification, 'verified');
    assert.equal(entry(await f.catalog(), 'reaction.get').verified, false);
    assert.equal(f.store.verified('T1', slackCredentialKey(TOKEN), 'reaction.get'), null);
    // Seed an isolated historical receipt; no fixture provider is labelled real.
    f.store.recordVerified('T1', slackCredentialKey(TOKEN), `${inbound.operation}.callback`);
    const historical = entry(await f.catalog(operator, false), inbound.operation);
    assert.equal(historical.available, false); assert.equal(historical.reason, 'inbound_unavailable');
    assert.equal(historical.verified, true); assert.equal(typeof historical.verifiedAt, 'number');
});


test('DM catalog includes access checks and mandatory mutation history scopes', async t => {
    const f = fixture(t, 'chat:write,im:read,users:read');
    const update = entry(await f.catalog(f.turn()), 'message.update');
    assert.equal(update.granted, false); assert.equal(update.available, false);
    assert.deepEqual(update.missingScopes, ['im:history']);
    assert.ok(update.conditionalScopes.some(item => item.oneOf.includes('groups:history')));
});
test('DM requester identity lookup is a required scope even for a reaction read', async t => {
    const f = fixture(t, 'reactions:read,im:read');
    const read = entry(await f.catalog(f.turn()), 'reaction.get');
    assert.equal(read.available, false); assert.deepEqual(read.missingScopes, ['users:read']);
});


test('catalog explicitly reports unavailable turn authorization and pooled native support', async t => {
    const f = fixture(t, 'chat:write,im:read,users:read');
    const catalog = await f.catalog(null);
    assert.equal(catalog.authorization.pooledNative, false);
    assert.equal(catalog.authorization.otherClis, false);
    assert.deepEqual(catalog.authorization.supportedPrintClis, ['cursor', 'claude', 'codex', 'grok']);
    assert.equal(entry(catalog, 'message').available, false);
    assert.equal(entry(catalog, 'message').reason, 'turn_authorization_unavailable');
});

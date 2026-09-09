import type { ActionDefinition } from './action-types.js';
import type { SlackToolPrincipal } from './tool-access.js';
import { readSlackAuthSnapshot } from './verified-workspace.js';
import { slackCredentialKey } from './tool-context.js';
import type { SlackActionStore } from './action-store.js';
import type { SlackFetch } from './api.js';
import { getRtsOutputStore } from './rts-output-store.js';
const SOURCE_TOOLS = [
    { operation: 'message', scopes: [] as string[] }, { operation: 'permalink', scopes: [] as string[] },
    { operation: 'quote', scopes: ['chat:write'] }, { operation: 'search.info', scopes: ['search:read.public'] },
    { operation: 'search.quote', scopes: ['search:read.public', 'chat:write'] },
];
export async function slackToolCapabilities(token: string | null, definitions: readonly ActionDefinition[], principal: SlackToolPrincipal | null,
    store: SlackActionStore | null, options: { fetchImpl?: SlackFetch; inboundReady: boolean } ) {
    const auth = token ? await readSlackAuthSnapshot(token, options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) : null;
    const entries = [...SOURCE_TOOLS.map(item => ({ ...item, methods: ['search.info'].includes(item.operation) ? [] : ['conversations.history'], mutates: false, requiresInbound: false })), ...definitions.map(item => ({ operation: item.operation, scopes: [...item.scopes], methods: item.methods, mutates: item.mutates, requiresInbound: item.requiresInbound === true }))];
    const capabilities = entries.map(item => {
        const readsHistory = item.methods.some(method => ['conversations.history', 'conversations.replies'].includes(method));
        const contextScopes = principal?.kind === 'turn' && principal.grant.destination.targetId.startsWith('D')
            ? ['im:read', 'users:read', ...(item.mutates && readsHistory ? ['im:history'] : [])] : [];
        const requiredScopes = [...new Set([...item.scopes, ...contextScopes])];
        const conditionalScopes = [
            ...(principal?.kind === 'turn' ? [{ purpose: 'source and destination membership', oneOf: ['channels:read', 'groups:read', 'im:read', 'mpim:read'] }] : []),
            ...(readsHistory ? [{ purpose: 'source or readback conversation history', oneOf: ['channels:history', 'groups:history', 'im:history', 'mpim:history'] }] : []),
        ];
        const granted = !token || !auth ? null : requiredScopes.length === 0 ? true : auth.scopes === null ? null : requiredScopes.every(scope => auth.scopes!.includes(scope));
        const missingScopes = auth?.scopes ? requiredScopes.filter(scope => !auth.scopes!.includes(scope)) : [];
        let reason: string | null = !token ? 'slack_unavailable' : !auth ? 'identity_unverified' : !principal ? 'turn_authorization_unavailable' : granted === null ? 'scopes_unverified' : !granted ? 'missing_scope' : null;
        if (!reason && principal?.kind === 'turn' && (principal.grant.signal.aborted || principal.grant.expiresAt <= Date.now()
            || principal.grant.teamId !== auth?.teamId || principal.grant.credentialKey !== slackCredentialKey(token!))) reason = 'turn_grant_stale';
        if (!reason && principal?.kind === 'turn' && /^(canvas|list)\./.test(item.operation) && !principal.grant.destination.targetId.startsWith('D')) reason = 'requester_dm_required';
        if (!reason && item.requiresInbound && !options.inboundReady) reason = 'inbound_unavailable';
        if (!reason && item.operation === 'search.quote' && (principal?.kind !== 'turn' || !principal.grant.actionToken)) reason = 'action_token_unavailable';
        if (!reason && item.operation === 'search.quote' && !getRtsOutputStore()) reason = 'privacy_store_unavailable';
        const verifiedAt = auth && token && store ? store.verified(auth.teamId, slackCredentialKey(token), item.requiresInbound ? `${item.operation}.callback` : item.operation) : null;
        return { operation: item.operation, implemented: true, requiredScopes, conditionalScopes, granted, missingScopes, available: reason === null,
            reason, verified: verifiedAt !== null, verifiedAt, resourceChecksRequired: true };
    });
    capabilities.push({ operation: 'modal.open', implemented: false, requiredScopes: [], conditionalScopes: [], granted: null, missingScopes: [], available: false,
        reason: 'response_capable_modal_ack_unimplemented', verified: false, verifiedAt: null, resourceChecksRequired: true });
    capabilities.push({ operation: 'search.raw', implemented: false, requiredScopes: ['search:read.public'], conditionalScopes: [], granted: null, missingScopes: [], available: false,
        reason: 'retention_path_unverified', verified: false, verifiedAt: null, resourceChecksRequired: true });
    return { ok: true, authorization: { supportedPrintClis: ['cursor', 'claude', 'codex', 'grok'], pooledNative: false, otherClis: false,
        limitation: 'Turn tools require a fresh supported print-process grant; pooled native and other CLI transports are unavailable.' }, observedAt: auth?.observedAt ?? null, scopesKnown: auth?.scopes !== null && auth !== null,
        verificationMeaning: 'observed real operation result; resource-specific and caller checks still apply', capabilities };
}

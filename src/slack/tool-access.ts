import { slackApi, type SlackFetch } from './api.js';
import { verifiedSlackWorkspace } from './verified-workspace.js';
import { resolveSlackToolGrant, slackCredentialKey, type SlackToolGrant } from './tool-context.js';

export type SlackToolPrincipal = { kind: 'operator' } | { kind: 'turn'; grant: SlackToolGrant };
export type SlackOperatorValidator = (candidate: string) => boolean;
export function slackToolDenied(code: string, statusCode = 403): Error {
    return Object.assign(new Error(code), { statusCode, code });
}
export function resolveSlackToolPrincipal(headers: Record<string, unknown>, operator: SlackOperatorValidator): SlackToolPrincipal {
    const grantHeader = headers['x-jaw-slack-grant'];
    if (typeof grantHeader === 'string') {
        const grant = resolveSlackToolGrant(grantHeader);
        if (!grant) throw slackToolDenied('slack_turn_grant_invalid', 401);
        return { kind: 'turn', grant };
    }
    const secret = headers['x-jaw-slack-operator'];
    if (typeof secret === 'string' && operator(secret)) return { kind: 'operator' };
    throw slackToolDenied('slack_turn_grant_required', 401);
}

async function membership(token: string, channel: string, grant: SlackToolGrant, fetchImpl?: SlackFetch, botUserId?: string | null, sensitiveResponse = false): Promise<Set<string>> {
    const options = { form: true as const, signal: grant.signal, sensitiveResponse, ...(fetchImpl ? { fetchImpl } : {}) };
    const info = await slackApi<{ channel?: { id?: string; is_shared?: boolean; is_ext_shared?: boolean; is_org_shared?: boolean; is_im?: boolean; user?: string; context_team_id?: string } }>(token, 'conversations.info', { channel }, options);
    if (info.error === 'ratelimited' || info.error === 'rate_limited') throw slackToolDenied('slack_tool_rate_limited', 429);
    const conversation = info.data?.channel;
    if (!info.ok || conversation?.id !== channel) throw slackToolDenied('slack_conversation_unverified');
    if (conversation.is_im === true) {
        // Slack's documented DM object omits channel sharing/team fields. Prove
        // its two participants and the actor's workspace instead of inventing defaults.
        // Omitted therefore means absent, never shared: a live DM that carries no
        // sharing fields at all must not fail closed as slack_conversation_unverified.
        // The two-person membership check below and the users.info workspace check are
        // what actually prove this DM, so the sharing fields only ever refute it.
        if ((conversation.is_org_shared !== undefined && conversation.is_org_shared !== false) || conversation.user !== grant.actorId || !botUserId
            || (conversation.is_ext_shared !== undefined && conversation.is_ext_shared !== false) || (conversation.is_shared !== undefined && conversation.is_shared !== false)
            || (conversation.context_team_id !== undefined && conversation.context_team_id !== grant.teamId)) throw slackToolDenied('slack_conversation_unverified');
        const identity = await slackApi<{ user?: { id?: string; team_id?: string; deleted?: boolean } }>(token, 'users.info', { user: grant.actorId }, options);
        if (identity.error === 'ratelimited' || identity.error === 'rate_limited') throw slackToolDenied('slack_tool_rate_limited', 429);
        if (!identity.ok || identity.data?.user?.id !== grant.actorId || identity.data.user.team_id !== grant.teamId || identity.data.user.deleted) throw slackToolDenied('slack_actor_workspace_unverified');
    } else if (conversation.is_shared !== false || conversation.is_ext_shared !== false
        || (conversation.is_org_shared !== undefined && conversation.is_org_shared !== false)
        || conversation.context_team_id !== grant.teamId) throw slackToolDenied('slack_conversation_unverified');
    const members = new Set<string>();
    const cursors = new Set<string>();
    let cursor = '';
    for (let page = 0; page < 10; page += 1) {
        const result = await slackApi<{ members?: unknown; has_more?: boolean; response_metadata?: { next_cursor?: string } }>(token, 'conversations.members', { channel, limit: 200, ...(cursor ? { cursor } : {}) }, options);
        if (result.error === 'ratelimited' || result.error === 'rate_limited') throw slackToolDenied('slack_tool_rate_limited', 429);
        if (!result.ok || !Array.isArray(result.data?.members) || result.data.members.length > 200 || result.data.members.some(id => typeof id !== 'string')) throw slackToolDenied('slack_membership_unverified');
        for (const id of result.data.members as string[]) members.add(id);
        if (typeof result.data.response_metadata?.next_cursor !== 'string') throw slackToolDenied('slack_membership_unverified');
        cursor = result.data.response_metadata.next_cursor.trim();
        if (!cursor && result.data.has_more === true) throw slackToolDenied('slack_membership_incomplete');
        if (!cursor) {
            if (conversation.is_im === true && (members.size !== 2 || !members.has(grant.actorId) || !members.has(botUserId!))) throw slackToolDenied('slack_dm_membership_unverified');
            return members;
        }
        if (cursors.has(cursor)) break;
        cursors.add(cursor);
    }
    throw slackToolDenied('slack_membership_incomplete');
}

const usage = new WeakMap<SlackToolGrant, { active: number; calls: number }>();
/** Checks disclosure membership before content access and cancellation after every await. */
export async function withSlackToolAccess<T>(token: string, principal: SlackToolPrincipal, sourceChannel: string | undefined,
    operation: (signal?: AbortSignal) => Promise<T>, fetchImpl?: SlackFetch, afterCancelledWrite?: (result: T) => T, sensitiveResponse = false): Promise<T> {
    if (principal.kind === 'operator') return operation();
    const grant = principal.grant;
    const current = () => {
        if (grant.signal.aborted || grant.expiresAt <= Date.now() || slackCredentialKey(token) !== grant.credentialKey) throw slackToolDenied('slack_turn_grant_expired', 401);
    };
    current();
    const budget = usage.get(grant) ?? { active: 0, calls: 0 };
    if (budget.active >= 4 || budget.calls >= 64) throw slackToolDenied('slack_tool_rate_limited', 429);
    budget.active += 1; budget.calls += 1; usage.set(grant, budget);
    try {
        const workspace = await verifiedSlackWorkspace(token, { fetchImpl, sensitiveResponse, signal: grant.signal }); current();
        if (workspace?.teamId !== grant.teamId) throw slackToolDenied('slack_workspace_mismatch');
        const destination = grant.destination.targetId;
        const source = sourceChannel ?? destination;
        if (!/^[CGD][A-Z0-9]+$/.test(source) || !/^[CGD][A-Z0-9]+$/.test(destination)) throw slackToolDenied('invalid_slack_channel', 400);
        const sourceMembers = await membership(token, source, grant, fetchImpl, workspace.userId, sensitiveResponse); current();
        if (!sourceMembers.has(grant.actorId)) throw slackToolDenied('slack_actor_not_member');
        if (source !== destination) {
            const destinationMembers = await membership(token, destination, grant, fetchImpl, workspace.userId, sensitiveResponse); current();
            if (!destinationMembers.has(grant.actorId) || [...destinationMembers].some(id => !sourceMembers.has(id))) throw slackToolDenied('slack_disclosure_denied');
        }
        const result = await operation(grant.signal);
        try { current(); } catch (error) { if (afterCancelledWrite) return afterCancelledWrite(result); throw error; }
        return result;
    } finally { budget.active -= 1; }
}

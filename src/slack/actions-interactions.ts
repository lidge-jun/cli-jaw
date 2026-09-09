import { randomBytes } from 'node:crypto';
import { defineAction, type ActionContext, type ActionBase } from './action-types.js';
import { baseAction, boundedInteger, enumValue, messageTs, onlyFields, opaqueId, requiredText, strictRecord } from './task-input.js';
import { redactChannelSecrets, redactOutboundText } from '../messaging/redact.js';
import { slackToolDenied } from './tool-access.js';
import { slackApi, type SlackFetch } from './api.js';
import { slackCredentialKey } from './tool-context.js';
import { getSlackInteractionConfiguration, type SlackInteraction } from './interaction-store.js';

const opaque = () => randomBytes(16).toString('hex');
const plain = (text: string) => ({ type: 'plain_text', text });
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
function safeText(value: unknown, max: number): string { return requiredText(redactOutboundText(requiredText(value, max)), max); }
function safeUrl(value: unknown): string {
    const url = requiredText(value, 2048); let parsed: URL;
    try { parsed = new URL(url); } catch { throw slackToolDenied('slack_link_invalid', 400); }
    if (url !== url.trim() || /[\x00-\x20\\]/.test(url) || parsed.protocol !== 'https:' || parsed.username || parsed.password || redactChannelSecrets(url) !== url) throw slackToolDenied('slack_link_unsafe', 400);
    return url;
}
type PostArgs = ActionBase & { text: string; threadTs?: string };
function parsePost(raw: Record<string, unknown>, fields: string[]): PostArgs {
    const base = baseAction(raw, ['text', 'threadTs', ...fields], true);
    return { ...base, text: safeText(raw['text'], 3000), ...(raw['threadTs'] === undefined ? {} : { threadTs: messageTs(raw['threadTs']) }) };
}
function array(value: unknown): unknown[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw slackToolDenied('slack_interaction_choices_invalid', 400);
    return value;
}
/** Compare chosen rendering/behavior fields; tolerate Slack's optional emoji and generated IDs. */
function sameElement(expected: Record<string, unknown>, actual: unknown): boolean {
    const found = record(actual); if (!found || found['type'] !== expected['type'] || found['action_id'] !== expected['action_id']) return false;
    for (const key of ['url', 'value']) if (found[key] !== expected[key]) return false;
    if (found['agent_prompt'] !== undefined || found['confirm'] !== undefined) return false;
    if (expected['type'] === 'button') return record(found['text'])?.['type'] === 'plain_text' && record(found['text'])?.['text'] === record(expected['text'])?.['text'];
    const options = found['options']; const wanted = expected['options'] as Record<string, unknown>[];
    return found['initial_option'] === undefined && found['option_groups'] === undefined && Array.isArray(options) && options.length === wanted.length
        && record(found['placeholder'])?.['type'] === 'plain_text' && record(found['placeholder'])?.['text'] === 'Choose an option'
        && wanted.every((o, i) => record(options[i])?.['value'] === o['value'] && record(record(options[i])?.['text'])?.['type'] === 'plain_text' && record(record(options[i])?.['text'])?.['text'] === record(o['text'])?.['text']);
}
async function post(ctx: ActionContext, args: PostArgs, blockId: string, elements: Record<string, unknown>[], interaction?: SlackInteraction) {
    const config = getSlackInteractionConfiguration();
    const ids = interaction ? [interaction.id] : [];
    try {
        const sent = await ctx.api<{ ts?: string; channel?: string }>('chat.postMessage', {
            channel: args.channel, text: args.text, blocks: [{ type: 'section', text: plain(args.text) }, { type: 'actions', block_id: blockId, elements }],
            ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
        }, () => {
            if (interaction && (getSlackInteractionConfiguration() !== config || ctx.now() >= interaction.expiresAt)) throw slackToolDenied('slack_interaction_expired', 409);
        });
        const ts = sent.data?.ts;
        if (!sent.ok || typeof ts !== 'string' || !/^\d{1,13}\.\d{1,6}$/.test(ts) || sent.data?.channel !== args.channel) return ctx.result('unknown', { interactionId: interaction?.id, reason: 'interaction_post_unconfirmed' }, ids);
        ids.push(ts);
        if (interaction && !config?.store.bind(interaction.id, ts)) return ctx.result('unknown', { interactionId: interaction.id, reason: 'interaction_binding_failed' }, ids);
        const read = await ctx.api<{ messages?: unknown[] }>(args.threadTs ? 'conversations.replies' : 'conversations.history', {
            channel: args.channel, ...(args.threadTs ? { ts: args.threadTs } : {}), oldest: ts, latest: ts, inclusive: true, limit: 100,
        });
        const matches = read.data?.messages?.filter(m => record(m)?.['ts'] === ts);
        const message = matches?.length === 1 ? record(matches[0]) : undefined;
        if (!read.ok || !message || message['contentExcluded'] === true) return ctx.result('unknown', { interactionId: interaction?.id, reason: 'interaction_readback_unavailable' }, ids);
        const blocks = message['blocks'];
        const actionBlocks = Array.isArray(blocks) ? blocks.filter(b => record(b)?.['block_id'] === blockId) : [];
        const got = actionBlocks.length === 1 ? record(actionBlocks[0]) : undefined;
        const actual = got?.['elements'];
        const verified = message['user'] === ctx.botUserId && message['text'] === args.text && (!args.threadTs || message['thread_ts'] === args.threadTs)
            && got?.['type'] === 'actions' && Array.isArray(actual) && actual.length === elements.length && elements.every((e, i) => sameElement(e, actual[i]));
        return ctx.result(verified ? 'verified' : 'failed', { ...(interaction ? { interactionId: interaction.id, expiresAt: interaction.expiresAt } : {}), channel: args.channel, ts, controls: verified ? 'verified' : 'mismatch' }, ids);
    } catch { return ctx.result('unknown', { interactionId: interaction?.id, reason: 'interaction_delivery_unconfirmed' }, ids); }
}
const postMethods = ['chat.postMessage', 'conversations.history', 'conversations.replies'];
export const interactionActions = [
    defineAction({ operation: 'interaction.url', scopes: ['chat:write'], methods: postMethods, mutates: true,
        parse(raw) {
            const args = parsePost(raw, ['buttons']);
            const buttons = array(raw['buttons']).map(value => { const b = strictRecord(value); onlyFields(b, ['text', 'url']); return { text: safeText(b['text'], 75), url: safeUrl(b['url']) }; });
            return { ...args, buttons };
        },
        execute(ctx, args) { return post(ctx, args, `jaw_url_${opaque()}`, args.buttons.map(b => ({ type: 'button', text: plain(b.text), url: b.url, action_id: `jaw_url_${opaque()}` }))); },
    }),
    defineAction({ operation: 'interaction.choice', scopes: ['chat:write'], methods: postMethods, mutates: true, requiresInbound: true,
        parse(raw) {
            const args = parsePost(raw, ['choices', 'style', 'expiresInSeconds']);
            const choices = array(raw['choices']).map(value => { const c = strictRecord(value); onlyFields(c, ['label', 'value']); const v = opaqueId(c['value']); if (redactChannelSecrets(v) !== v) throw slackToolDenied('slack_interaction_value_unsafe', 400); return { label: safeText(c['label'], 75), value: v }; });
            if (new Set(choices.map(c => c.value)).size !== choices.length) throw slackToolDenied('slack_interaction_duplicate_choice', 400);
            return { ...args, choices, style: raw['style'] === undefined ? 'buttons' as const : enumValue(raw['style'], ['buttons', 'select'] as const), expiresInSeconds: raw['expiresInSeconds'] === undefined ? 900 : boundedInteger(raw['expiresInSeconds'], 1, 900) };
        },
        execute(ctx, args) {
            if (ctx.operator || !/^[UW][A-Z0-9]+$/.test(ctx.actor)) return Promise.resolve(ctx.fail('slack_interaction_turn_required', 403));
            const config = getSlackInteractionConfiguration();
            if (!config || slackCredentialKey(config.getToken()) !== ctx.credentialKey) return Promise.resolve(ctx.fail('slack_interaction_unavailable', 503));
            const id = opaque(); const actionId = `jaw_choice_${opaque()}`;
            const row: SlackInteraction = { id, workspace: ctx.workspace, channel: args.channel, actor: ctx.actor, botUserId: ctx.botUserId, credentialKey: ctx.credentialKey,
                blockId: `jaw_choice_${id}`, style: args.style, options: args.choices.map(c => ({ actionId: args.style === 'select' ? actionId : `jaw_choice_${opaque()}`, wireValue: opaque(), value: c.value })),
                expiresAt: ctx.now() + args.expiresInSeconds * 1000, messageTs: null, selectedValue: null };
            config.store.create(row, ctx.now());
            const elements = args.style === 'buttons' ? args.choices.map((c, i) => ({ type: 'button', text: plain(c.label), action_id: row.options[i]!.actionId, value: row.options[i]!.wireValue }))
                : [{ type: 'static_select', action_id: actionId, placeholder: plain('Choose an option'), options: args.choices.map((c, i) => ({ text: plain(c.label), value: row.options[i]!.wireValue })) }];
            return post(ctx, args, row.blockId, elements, row);
        },
    }),
    defineAction({ operation: 'interaction.get', scopes: [], methods: [], mutates: false,
        parse(raw) { return { ...baseAction(raw, ['interactionId'], false), interactionId: opaqueId(raw['interactionId']) }; },
        async execute(ctx, args) {
            const row = getSlackInteractionConfiguration()?.store.get(args.interactionId);
            if (ctx.operator || !row || row.workspace !== ctx.workspace || row.channel !== args.channel || row.actor !== ctx.actor || row.botUserId !== ctx.botUserId || row.credentialKey !== ctx.credentialKey) return ctx.fail('slack_interaction_owner_unverified', 403);
            return ctx.result('verified', { interactionId: row.id, status: row.selectedValue !== null ? 'selected' : ctx.now() >= row.expiresAt ? 'expired' : row.messageTs === null ? 'unbound' : 'pending', selectedValue: row.selectedValue, expiresAt: row.expiresAt }, [row.id]);
        },
    }),
];

/** Authenticated Socket transport ONLY; payload.token and response_url are never credentials or destinations. */
export async function consumeSlackInteractionCallback(payload: unknown, token: string, fetchImpl?: SlackFetch): Promise<{ accepted: boolean }> {
    const config = getSlackInteractionConfiguration();
    if (!config) return { accepted: false };
    const p = record(payload); const actions = p?.['actions'];
    if (p?.['type'] !== 'block_actions' || !Array.isArray(actions) || actions.length !== 1) return { accepted: false };
    const action = record(actions[0]); const block = action?.['block_id'];
    if (typeof block !== 'string' || !/^jaw_choice_[a-f0-9]{32}$/.test(block)) return { accepted: false };
    const row = config.store.get(block.slice('jaw_choice_'.length));
    const container = record(p['container']); const user = record(p['user']); const team = record(p['team']);
    const value = action?.['type'] === 'static_select' ? record(action['selected_option'])?.['value'] : action?.['value'];
    if (!row || !row.messageTs || row.selectedValue !== null || container?.['type'] !== 'message' || container['is_ephemeral'] === true
        || container['channel_id'] !== row.channel || container['message_ts'] !== row.messageTs || user?.['id'] !== row.actor || team?.['id'] !== row.workspace
        || (record(p['channel']) && record(p['channel'])?.['id'] !== row.channel) || (record(p['message']) && record(p['message'])?.['ts'] !== row.messageTs)
        || action?.['type'] !== (row.style === 'buttons' ? 'button' : 'static_select') || typeof value !== 'string' || typeof action['action_id'] !== 'string'
        || !row.options.some(o => o.actionId === action['action_id'] && o.wireValue === value)) return { accepted: false };
    const current = () => getSlackInteractionConfiguration() === config && config.now() < row.expiresAt && slackCredentialKey(token) === row.credentialKey && slackCredentialKey(config.getToken()) === row.credentialKey;
    if (!current()) return { accepted: false };
    try {
        const options = { ...(fetchImpl ? { fetchImpl } : {}), sensitiveResponse: true, maxResponseBytes: 65536, timeoutMs: 5000, form: true };
        const auth = await slackApi<{ team_id?: string; user_id?: string }>(token, 'auth.test', {}, options);
        if (!current() || !auth.ok || auth.data?.team_id !== row.workspace || auth.data.user_id !== row.botUserId) return { accepted: false };
        const info = await slackApi<{ channel?: Record<string, unknown> }>(token, 'conversations.info', { channel: row.channel }, options);
        const channel = info.data?.channel;
        if (!current() || !info.ok || channel?.['id'] !== row.channel || channel['is_shared'] === true || channel['is_ext_shared'] === true || channel['is_org_shared'] === true) return { accepted: false };
        if (channel['is_im'] === true) {
            if (channel['user'] !== row.actor || channel['is_org_shared'] !== false
                || (channel['is_shared'] !== undefined && channel['is_shared'] !== false)
                || (channel['is_ext_shared'] !== undefined && channel['is_ext_shared'] !== false)
                || (channel['context_team_id'] !== undefined && channel['context_team_id'] !== row.workspace)) return { accepted: false };
            const actor = await slackApi<{ user?: { id?: string; team_id?: string; deleted?: boolean } }>(token, 'users.info', { user: row.actor }, options);
            if (!current() || !actor.ok || actor.data?.user?.id !== row.actor || actor.data.user.team_id !== row.workspace || actor.data.user.deleted !== false) return { accepted: false };
        } else if (channel['is_shared'] !== false || channel['is_ext_shared'] !== false || channel['context_team_id'] !== row.workspace) return { accepted: false };
        const members = await slackApi<{ members?: string[]; response_metadata?: { next_cursor?: string }; has_more?: boolean }>(token, 'conversations.members', { channel: row.channel, limit: 200 }, options);
        if (!current() || !members.ok || !Array.isArray(members.data?.members) || members.data.members.length > 200 || !members.data.members.includes(row.actor) || !members.data.members.includes(row.botUserId)) return { accepted: false };
        if (channel['is_im'] === true && (members.data.members.length !== 2 || members.data.has_more === true || members.data.response_metadata?.next_cursor !== '')) return { accepted: false };
        const accepted = config.store.consume(row, action['action_id'], value, config.now());
        if (accepted && config.onVerified) {
            // Evidence failure cannot undo the durable choice or make a replay eligible.
            try { config.onVerified(row.workspace, row.credentialKey, 'interaction.choice'); }
            catch { return { accepted: true }; }
        }
        return { accepted };
    } catch { return { accepted: false }; }
}

import { isDeepStrictEqual } from 'node:util';
import { defineAction, type ActionBase, type ActionContext, type ActionResult } from './action-types.js';
import { baseAction, boundedInteger, messageTs, opaqueId, requiredText } from './task-input.js';
import { buildSlackBlockPayloads, type SlackTextPayload } from './blocks.js';
import { isRtsOutput } from './rts-output-store.js';
import { slackToolDenied } from './tool-access.js';

type Args = ActionBase & { scheduledId?: string; postAt?: number; threadTs?: string; parts?: SlackTextPayload[] };
type Scheduled = { id: string; channel_id: string; post_at: number; text: string; blocks?: unknown; thread_ts?: string };
const MAX_FUTURE_SECONDS = 120 * 86400;
function parse(raw: Record<string, unknown>, kind: string): Args {
    const fields = kind === 'list' ? [] : kind === 'cancel' ? ['scheduledId'] : ['postAt', 'threadTs', 'text', 'blocks', ...(kind === 'update' ? ['scheduledId'] : [])];
    const base = baseAction(raw, fields, kind !== 'list');
    const scheduledId = kind === 'cancel' || kind === 'update' ? opaqueId(raw['scheduledId']) : undefined;
    const postAt = kind === 'create' || raw['postAt'] !== undefined ? boundedInteger(raw['postAt'], 1, Number.MAX_SAFE_INTEGER) : undefined;
    const threadTs = raw['threadTs'] === undefined ? undefined : messageTs(raw['threadTs']);
    let parts: SlackTextPayload[] | undefined;
    if (kind === 'create' || raw['text'] !== undefined || raw['blocks'] !== undefined) {
        parts = buildSlackBlockPayloads(requiredText(raw['text'], 1048576), raw['blocks']);
        validateParts(parts);
    }
    if (kind === 'update' && postAt === undefined && parts === undefined && threadTs === undefined) throw slackToolDenied('empty_schedule_update', 400);
    return { ...base, ...(scheduledId ? { scheduledId } : {}), ...(postAt === undefined ? {} : { postAt }), ...(threadTs ? { threadTs } : {}), ...(parts ? { parts } : {}) };
}
function validateParts(parts: SlackTextPayload[]) {
    if (!parts.length || parts.length > 20 || parts.some(p => typeof p.text !== 'string' || !p.text.trim() || isRtsOutput(p.blocks)
        || Buffer.byteLength(JSON.stringify({ payload: p, postAt: Number.MAX_SAFE_INTEGER, threadTs: '9999999999999.999999' })) > 262144)) throw slackToolDenied('invalid_schedule_payload', 400);
}
function validTime(ctx: ActionContext, postAt: number): boolean {
    const now = Math.floor(ctx.now() / 1000);
    return postAt > now && postAt <= now + MAX_FUTURE_SECONDS;
}
async function list(ctx: ActionContext, channel: string) {
    const items: Scheduled[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
        const res = await ctx.api<{ scheduled_messages?: Scheduled[]; response_metadata?: { next_cursor?: string } }>('chat.scheduledMessages.list', { channel, limit: 100, ...(cursor ? { cursor } : {}) });
        if (!res.ok || !Array.isArray(res.data?.scheduled_messages)) return { items, complete: false };
        if (res.data.scheduled_messages.some(m => typeof m.id !== 'string' || m.channel_id !== channel || !Number.isSafeInteger(m.post_at) || typeof m.text !== 'string')) return { items, complete: false };
        items.push(...res.data.scheduled_messages);
        const next = res.data.response_metadata?.next_cursor;
        if (next === undefined || next === '') return { items, complete: true };
        if (typeof next !== 'string' || cursors.has(next)) return { items, complete: false };
        cursors.add(next); cursor = next;
    }
    return { items, complete: false };
}
function owned(ctx: ActionContext, args: Args) {
    const row = ctx.resource('schedule', args.scheduledId!);
    if (!row || row.status !== 'active' || row.workspace !== ctx.workspace || row.channel !== args.channel || row.botUserId !== ctx.botUserId || (!ctx.operator && row.actor !== ctx.actor)) return { error: 'schedule_owner_unverified' } as const;
    if (!row.credentialKey || row.credentialKey !== ctx.credentialKey) return { error: 'schedule_credential_changed' } as const;
    return { row } as const;
}
async function create(ctx: ActionContext, args: Args) {
    const ids: string[] = [];
    if (!validTime(ctx, args.postAt!)) return ctx.fail('invalid_schedule_time', 400);
    for (const payload of args.parts!) {
        if (!validTime(ctx, args.postAt!)) return ctx.result(ids.length ? 'partial' : 'failed', { reason: 'schedule_time_elapsed', created: ids.length }, ids);
        let res;
        let timeRejected = false;
        try {
            res = await ctx.api<{ scheduled_message_id?: string }>('chat.scheduleMessage', {
                channel: args.channel, post_at: args.postAt, text: payload.text, ...(payload.blocks ? { blocks: payload.blocks } : {}), ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
            }, () => {
                if (!validTime(ctx, args.postAt!)) {
                    timeRejected = true;
                    throw slackToolDenied('invalid_schedule_time', 400);
                }
            });
        } catch {
            if (timeRejected) return ctx.result(ids.length ? 'partial' : 'failed', { reason: 'schedule_time_elapsed', created: ids.length }, ids);
            return ctx.result(ids.length ? 'partial' : 'unknown', { reason: 'schedule_creation_unconfirmed', created: ids.length }, ids);
        }
        const id = res.data?.scheduled_message_id;
        if (!res.ok || typeof id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(id)) return ctx.result(ids.length ? 'partial' : 'unknown', { reason: 'schedule_creation_unconfirmed', created: ids.length }, ids);
        ids.push(id);
        // Persist each acknowledged address synchronously before another remote call.
        try { ctx.remember('schedule', id, { payload, postAt: args.postAt, ...(args.threadTs ? { threadTs: args.threadTs } : {}) }); }
        catch { return ctx.result('partial', { reason: 'schedule_ownership_persistence_failed', created: ids.length }, ids); }
    }
    let observed;
    try { observed = await list(ctx, args.channel); }
    catch { return ctx.result('unknown', { reason: 'schedule_readback_unavailable' }, ids); }
    let richComplete = true;
    for (let i = 0; i < ids.length; i++) {
        const matches = observed.items.filter(m => m.id === ids[i]);
        if (matches.length !== 1) return ctx.result('unknown', { reason: 'schedule_readback_missing' }, ids);
        const found = matches[0]!; const payload = args.parts![i]!;
        if (found.post_at !== args.postAt || found.text !== payload.text) return ctx.result('failed', { reason: 'schedule_readback_mismatch' }, ids);
        if (payload.blocks !== undefined) {
            if (found.blocks === undefined) richComplete = false;
            else if (!isDeepStrictEqual(found.blocks, payload.blocks)) return ctx.result('failed', { reason: 'schedule_blocks_mismatch' }, ids);
        }
        if (args.threadTs) {
            if (found.thread_ts === undefined) richComplete = false;
            else if (found.thread_ts !== args.threadTs) return ctx.result('failed', { reason: 'schedule_thread_mismatch' }, ids);
        }
    }
    return ctx.result(richComplete ? 'verified' : 'partial', { scheduled: ids.length, content: richComplete ? 'verified' : 'text_verified', richThread: richComplete ? 'verified' : 'not_checked' }, ids);
}
async function cancel(ctx: ActionContext, args: Args) {
    const ownership = owned(ctx, args);
    if (ownership.error) return ctx.fail(ownership.error, 403);
    const postAt = ownership.row.metadata['postAt'];
    if (typeof postAt !== 'number' || postAt - Math.floor(ctx.now() / 1000) <= 60) return ctx.fail('schedule_cancel_too_late', 409, [args.scheduledId!]);
    let res;
    let timeRejected = false;
    try {
        res = await ctx.api('chat.deleteScheduledMessage', { channel: args.channel, scheduled_message_id: args.scheduledId }, () => {
            if (postAt - Math.floor(ctx.now() / 1000) <= 60) {
                timeRejected = true;
                throw slackToolDenied('schedule_cancel_too_late', 409);
            }
        });
    } catch {
        if (timeRejected) return ctx.fail('schedule_cancel_too_late', 409, [args.scheduledId!]);
        return ctx.result('unknown', { reason: 'schedule_cancel_unconfirmed' }, [args.scheduledId!]);
    }
    if (!res.ok) return ctx.result('unknown', { reason: 'schedule_cancel_unconfirmed' }, [args.scheduledId!]);
    let after;
    try { after = await list(ctx, args.channel); ctx.checkCurrent(); }
    catch { return ctx.result('unknown', { reason: 'schedule_absence_unverified' }, [args.scheduledId!]); }
    if (!after.complete) return ctx.result('unknown', { reason: 'schedule_absence_unverified' }, [args.scheduledId!]);
    if (after.items.some(m => m.id === args.scheduledId)) return ctx.result('failed', { cancelled: false }, [args.scheduledId!]);
    ctx.retire('schedule', args.scheduledId!);
    return ctx.result('verified', { cancelled: true }, [args.scheduledId!]);
}
async function update(ctx: ActionContext, args: Args): Promise<ActionResult> {
    const ownership = owned(ctx, args);
    if (ownership.error) return ctx.fail(ownership.error, 403);
    const stored = ownership.row.metadata;
    const payload = stored['payload'];
    if (!args.parts && (!payload || typeof payload !== 'object' || Array.isArray(payload))) return ctx.fail('schedule_payload_unavailable', 409);
    const parts = args.parts ?? [payload as SlackTextPayload];
    validateParts(parts);
    const postAt = args.postAt ?? stored['postAt'];
    if (typeof postAt !== 'number' || !Number.isSafeInteger(postAt) || !validTime(ctx, postAt)) return ctx.fail('invalid_schedule_time', 400);
    const threadTs = args.threadTs ?? (typeof stored['threadTs'] === 'string' ? stored['threadTs'] : undefined);
    const cancelled = await cancel(ctx, args);
    if (cancelled.verification !== 'verified') return cancelled;
    try {
        const replacement = await create(ctx, { ...args, parts, postAt, ...(threadTs ? { threadTs } : {}) });
        return { ...replacement, verification: replacement.verification === 'verified' ? 'verified' : 'partial', partial: replacement.verification !== 'verified',
            resourceIds: [args.scheduledId!, ...replacement.resourceIds], data: { oldCancelled: true, replacement: replacement.data } };
    } catch {
        return ctx.result('partial', { oldCancelled: true, replacement: 'unconfirmed' }, [args.scheduledId!]);
    }
}
export const scheduleActions = (['create', 'list', 'cancel', 'update'] as const).map(kind => defineAction({
    operation: `schedule.${kind}`, scopes: kind === 'list' ? [] : ['chat:write'], mutates: kind !== 'list',
    methods: ['chat.scheduledMessages.list', ...(kind === 'create' || kind === 'update' ? ['chat.scheduleMessage'] : []), ...(kind === 'cancel' || kind === 'update' ? ['chat.deleteScheduledMessage'] : [])],
    parse: raw => parse(raw, kind),
    async execute(ctx, args) {
        if (kind === 'create') return create(ctx, args);
        if (kind === 'cancel') return cancel(ctx, args);
        if (kind === 'update') return update(ctx, args);
        const ledger = ctx.resources('schedule').filter(r => r.kind === 'schedule' && r.workspace === ctx.workspace && r.channel === args.channel && r.botUserId === ctx.botUserId && r.status === 'active' && (ctx.operator || r.actor === ctx.actor));
        const observed = await list(ctx, args.channel);
        const visible = observed.items.filter(m => ctx.operator || ledger.some(r => r.id === m.id && r.credentialKey === ctx.credentialKey));
        const oldCredentialPending = ledger.filter(r => r.credentialKey !== ctx.credentialKey).map(r => r.id);
        return ctx.result(observed.complete && !oldCredentialPending.length ? 'verified' : 'partial', {
            schedules: visible.map(m => ({ scheduledId: m.id, channel: m.channel_id, postAt: m.post_at })),
            complete: observed.complete && !oldCredentialPending.length, scope: 'same_token_api_schedules', oldCredentialPending,
        }, visible.map(m => m.id));
    },
}));

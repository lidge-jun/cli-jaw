import { defineAction } from './action-types.js';
import { baseAction, boundedInteger, messageTs, opaqueId } from './task-input.js';
import { getRtsOutputStore, RTS_OUTPUT_MARKER } from './rts-output-store.js';

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function timestamp(value: unknown): value is string { return typeof value === 'string' && /^\d{1,13}\.\d{1,6}$/.test(value); }
export const rtsActions = [defineAction({
    // Like source history, scope depends on the current conversation; ctx.api and current permission checks are authoritative.
    operation: 'rts.reconcile', scopes: [],
    methods: ['conversations.history', 'conversations.replies'], mutates: false,
    parse(raw) {
        return { ...baseAction(raw, ['threadTs', 'maxPages'], false), invocationId: opaqueId(raw['invocationId'], 64),
            threadTs: raw['threadTs'] === undefined ? null : messageTs(raw['threadTs']),
            maxPages: raw['maxPages'] === undefined ? 10 : boundedInteger(raw['maxPages'], 1, 10) };
    },
    async execute(ctx, args) {
        ctx.checkCurrent();
        const store = getRtsOutputStore();
        if (!store) return ctx.fail('slack_rts_privacy_unavailable', 503);
        const proof = store.publication(ctx.workspace, args.channel, args.invocationId);
        if (!proof || proof.state !== 'terminal' || proof.terminalAt === null) return ctx.fail('slack_rts_terminal_proof_required', 409);
        if (proof.threadTs !== args.threadTs || proof.botUserId !== ctx.botUserId || proof.credentialKey !== ctx.credentialKey
            || (!ctx.operator && proof.actor !== ctx.actor) || args.channel !== ctx.channel) return ctx.fail('slack_rts_scope_mismatch', 403);
        const marker = `${RTS_OUTPUT_MARKER}:${args.invocationId}`;
        const outputs = new Set<string>(); const seen = new Set<string>(); const cursors = new Set<string>();
        let cursor = ''; let complete = false;
        try {
            // Exhaust the exact conversation/thread, not a caller-selected time window.
            for (let page = 0; page < args.maxPages; page++) {
                const result = await ctx.api(args.threadTs ? 'conversations.replies' : 'conversations.history', {
                    channel: args.channel, ...(args.threadTs ? { ts: args.threadTs } : {}), limit: 100,
                    ...(cursor ? { cursor } : {}),
                }); ctx.checkCurrent();
                const messages = result.data?.['messages'];
                const next = record(result.data?.['response_metadata'])?.['next_cursor'];
                if (!result.ok || !Array.isArray(messages) || messages.length > 100 || typeof next !== 'string' || next.length > 2048
                    || result.data?.['partial'] === true || result.data?.['contentTruncated'] === true) return ctx.result('partial', { held: true, reason: 'scan_incomplete' });
                for (const value of messages) {
                    const message = record(value);
                    if (!message || !timestamp(message['ts']) || seen.has(message['ts'])) return ctx.result('partial', { held: true, reason: 'scan_ambiguous' });
                    seen.add(message['ts']);
                    if (message['contentExcluded'] === true || message['contentTruncated'] === true) return ctx.result('partial', { held: true, reason: 'scan_excluded' });
                    const blocks = message['blocks'];
                    if (blocks !== undefined && (!Array.isArray(blocks) || blocks.length > 50)) return ctx.result('partial', { held: true, reason: 'scan_invalid' });
                    if (!Array.isArray(blocks) || !blocks.some(block => record(block)?.['block_id'] === marker)) continue;
                    const thread = message['thread_ts'];
                    if (message['user'] !== ctx.botUserId || (args.threadTs ? thread !== args.threadTs : thread !== undefined && thread !== message['ts'])) return ctx.result('partial', { held: true, reason: 'marker_scope_mismatch' });
                    outputs.add(message['ts']);
                }
                if (!next) {
                    if (result.data?.['has_more'] !== false) return ctx.result('partial', { held: true, reason: 'scan_completion_unproven' });
                    complete = true; break;
                }
                if (cursors.has(next)) return ctx.result('partial', { held: true, reason: 'cursor_repeated' });
                cursors.add(next); cursor = next;
            }
            if (!complete || outputs.size !== proof.expectedOutputs) return ctx.result('partial', { held: true, matchedCount: outputs.size, reason: 'output_count_unproven' });
            ctx.checkCurrent();
            const ids = [...outputs];
            if (!store.reconcile(ctx.workspace, args.channel, args.invocationId, proof.lease, ids)) return ctx.fail('slack_rts_reconcile_conflict', 409);
            return ctx.result('verified', { held: store.held(ctx.workspace, args.channel), reconciled: true, outputCount: ids.length }, ids);
        } catch { return ctx.result('unknown', { held: true, reason: 'scan_unavailable' }); }
    },
})];

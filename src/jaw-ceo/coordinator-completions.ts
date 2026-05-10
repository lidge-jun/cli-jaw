import {
    canCreateFallbackCompletion,
    completionFromDoneEvent,
    completionFromInstanceMessage,
    previewWorkerResultText,
} from './completion.js';
import type { JawCeoCoordinatorContext } from './coordinator-types.js';
import { auditTool, isPositivePort, nowIso } from './coordinator-utils.js';
import type { JawCeoCompletion, JawCeoManagerEvent, JawCeoResponseMode, JawCeoToolResult } from './types.js';

export function ingestManagerEvent(ctx: JawCeoCoordinatorContext, event: JawCeoManagerEvent): { ok: true; completion?: JawCeoCompletion } | { ok: false; code: string; message: string } {
    if (event.kind === 'instance-message') {
        if (!isPositivePort(event.port) || !Number.isInteger(event.messageId)) {
            return { ok: false, code: 'invalid_instance_message', message: 'instance-message event must include port and messageId' };
        }
        if (event.role !== 'assistant') {
            return { ok: false, code: 'non_assistant_message', message: 'only assistant messages can complete CEO watches' };
        }
        const watch = ctx.store.findWatchesByPort(event.port)[0];
        if (!watch) return { ok: false, code: 'watch_not_found', message: 'no active CEO watch for this port' };
        const allowed = canCreateFallbackCompletion({
            watch,
            messageId: event.messageId,
            ...(event.postWatchFingerprint ? { postWatchFingerprint: event.postWatchFingerprint } : {}),
        });
        if (!allowed.ok) return allowed;
        const completion = ctx.store.upsertCompletion(completionFromInstanceMessage({
            port: event.port,
            messageId: event.messageId,
            at: event.at,
            watch,
            ...(event.text ? { text: event.text } : {}),
        }));
        ctx.store.appendAudit({
            kind: 'completion',
            action: 'completion.latest_message_fallback',
            ok: true,
            port: event.port,
            message: `Created pending completion for worker :${event.port}.`,
            meta: { completionKey: completion.completionKey },
        });
        return { ok: true, completion };
    }
    if (event.kind === 'instance-completed') {
        const watch = ctx.store.findWatchesByPort(event.port)[0];
        if (!watch) return { ok: false, code: 'watch_not_found', message: 'no active CEO watch for completed instance' };
        const completion = completionFromDoneEvent({ event, watch });
        const existing = ctx.store.listPending().find(row => row.dispatchRef === watch.dispatchRef && row.watchId === watch.watchId && row.port === event.port);
        const stored = existing
            ? ctx.store.upsertCompletion({
                ...existing,
                source: event.source,
                requestId: completion.requestId,
                messageId: completion.messageId,
                aliases: [...(existing.aliases || []), completion.completionKey],
            })
            : ctx.store.upsertCompletion(completion);
        if (existing) ctx.store.aliasCompletion(completion.completionKey, existing.completionKey);
        ctx.store.appendAudit({
            kind: 'completion',
            action: `completion.${event.source}`,
            ok: true,
            port: event.port,
            message: `Created real done completion for worker :${event.port}.`,
            meta: { completionKey: stored.completionKey },
        });
        return { ok: true, completion: stored };
    }
    return { ok: true };
}

export async function refreshEvents(ctx: JawCeoCoordinatorContext, args: { ports?: number[] | undefined; events?: JawCeoManagerEvent[] | undefined; sinceCursor?: string | undefined }): Promise<{ pending: JawCeoCompletion[]; cursor: string }> {
    void args.sinceCursor;
    for (const event of args.events || []) ingestManagerEvent(ctx, event);
    const watchedPorts = args.ports && args.ports.length > 0
        ? args.ports
        : Array.from(new Set(ctx.store.listWatches().map(watch => watch.port)));
    if (ctx.deps.fetchLatestMessage) {
        for (const port of watchedPorts) {
            if (!isPositivePort(port)) continue;
            const latest = await ctx.deps.fetchLatestMessage(port).catch(() => null);
            const assistant = latest?.latestAssistant;
            if (!assistant) continue;
            ingestManagerEvent(ctx, {
                kind: 'instance-message',
                port,
                messageId: assistant.id,
                role: assistant.role,
                at: assistant.created_at || nowIso(ctx.now),
                ...(assistant.text ? { text: assistant.text } : {}),
            });
        }
    }
    return { pending: ctx.store.listPending(), cursor: nowIso(ctx.now) };
}

function completionResultText(completion: JawCeoCompletion): string {
    return completion.resultText || completion.summary || `Worker :${completion.port} has a result ready.`;
}

function publicContinuationCompletion(completion: JawCeoCompletion): Omit<JawCeoCompletion, 'resultText'> {
    const { resultText: _resultText, ...safe } = completion;
    void _resultText;
    return safe;
}

export function continueCompletion(ctx: JawCeoCoordinatorContext, completionKey: string, mode: JawCeoResponseMode = 'text'): JawCeoToolResult {
    const completion = ctx.store.updateCompletionStatus(completionKey, mode === 'voice' || mode === 'both' ? 'spoken' : 'acknowledged');
    if (!completion) {
        ctx.store.appendTranscript({
            role: 'tool',
            text: 'Pending completion was not found.',
            source: 'completion',
        });
        return auditTool(ctx.store, {
            tool: 'ceo.continue_completion',
            ok: false,
            code: 'completion_not_found',
            message: 'pending completion was not found',
            sourceLabels: ['dashboard'],
        });
    }
    const silent = mode === 'silent';
    if (!silent) {
        ctx.store.appendTranscript({
            role: 'ceo',
            text: completionResultText(completion),
            source: 'completion',
        });
    }
    return auditTool(ctx.store, {
        tool: 'ceo.continue_completion',
        ok: true,
        port: completion.port,
        message: silent ? `Silently acknowledged completion from worker :${completion.port}.` : `Continuing completion from worker :${completion.port}.`,
        data: silent
            ? {
                completionKey: completion.completionKey,
                port: completion.port,
                status: completion.status,
                source: completion.source,
            }
            : { response: completionResultText(completion), completion: publicContinuationCompletion(completion) },
        ...(!silent && completion.resultText ? { untrustedText: completion.resultText } : {}),
        sourceLabels: ['dashboard', `worker:${completion.port}`],
    });
}

export function summarizeCompletion(ctx: JawCeoCoordinatorContext, completionKey: string, format: 'short' | 'detailed' = 'short'): JawCeoToolResult {
    const completion = ctx.store.getCompletion(completionKey);
    if (!completion) {
        ctx.store.appendTranscript({
            role: 'tool',
            text: 'Pending completion was not found.',
            source: 'completion',
        });
        return auditTool(ctx.store, {
            tool: 'ceo.summarize_completion',
            ok: false,
            code: 'completion_not_found',
            message: 'pending completion was not found',
            sourceLabels: ['dashboard'],
        });
    }
    const summary = completion.resultText
        ? format === 'detailed'
            ? completion.resultText
            : previewWorkerResultText(completion.resultText) || `Worker :${completion.port} has a result ready.`
        : format === 'detailed'
            ? `${completion.summary || 'Worker result is ready.'} Open worker :${completion.port} for the full result.`
            : completion.summary || `Worker :${completion.port} has a result ready.`;
    ctx.store.appendTranscript({
        role: 'ceo',
        text: summary,
        source: 'completion',
    });
    return auditTool(ctx.store, {
        tool: 'ceo.summarize_completion',
        ok: true,
        port: completion.port,
        message: 'Summarized pending completion.',
        data: { summary, completion },
        ...(completion.resultText ? { untrustedText: completion.resultText } : {}),
        sourceLabels: ['dashboard', `worker:${completion.port}`],
    });
}

export function updatePendingStatus(ctx: JawCeoCoordinatorContext, completionKey: string, status: 'acknowledged' | 'dismissed' | 'spoken'): JawCeoToolResult {
    const completion = ctx.store.updateCompletionStatus(completionKey, status);
    if (!completion) {
        return auditTool(ctx.store, {
            tool: `ceo.${status}_completion`,
            ok: false,
            code: 'completion_not_found',
            message: 'pending completion was not found',
            sourceLabels: ['dashboard'],
        });
    }
    return auditTool(ctx.store, {
        tool: `ceo.${status}_completion`,
        ok: true,
        port: completion.port,
        message: `Marked completion ${status}.`,
        data: completion,
        sourceLabels: ['dashboard'],
    });
}

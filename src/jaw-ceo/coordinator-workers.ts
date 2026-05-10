import { randomUUID } from 'node:crypto';
import type { JawCeoCoordinatorContext, JawCeoMessageInput } from './coordinator-types.js';
import { auditTool, isPositivePort, nowIso } from './coordinator-utils.js';
import type {
    JawCeoCompletion,
    JawCeoLatestMessageFallback,
    JawCeoResponseMode,
    JawCeoToolResult,
    JawCeoWatch,
    JawCeoWatchReason,
} from './types.js';

export async function listInstances(ctx: JawCeoCoordinatorContext, args: { includeHidden?: boolean | undefined } = {}): Promise<JawCeoToolResult<import('./types.js').JawCeoInstanceSummary[]>> {
    void args;
    if (!ctx.deps.listInstances) {
        return auditTool(ctx.store, {
            tool: 'dashboard.list_instances',
            ok: true,
            message: 'No manager instance adapter is available in this host.',
            data: [],
            sourceLabels: ['dashboard'],
        });
    }
    try {
        const instances = await ctx.deps.listInstances();
        return auditTool(ctx.store, {
            tool: 'dashboard.list_instances',
            ok: true,
            message: `Listed ${instances.length} worker instance(s).`,
            data: instances,
            sourceLabels: ['dashboard'],
        });
    } catch (error) {
        return auditTool(ctx.store, {
            tool: 'dashboard.list_instances',
            ok: false,
            code: 'instance_list_failed',
            message: (error as Error).message,
            sourceLabels: ['dashboard'],
        });
    }
}

export async function inspectInstance(ctx: JawCeoCoordinatorContext, args: { port: number; depth: 'summary' | 'latest' | 'recent' }): Promise<JawCeoToolResult> {
    if (!isPositivePort(args.port)) {
        return auditTool(ctx.store, {
            tool: 'dashboard.inspect_instance',
            ok: false,
            code: 'invalid_port',
            message: 'port must be a positive integer',
            sourceLabels: ['dashboard'],
        });
    }
    const instances = await ctx.deps.listInstances?.() ?? [];
    const instance = instances.find(row => row.port === args.port) || null;
    const latest = args.depth !== 'summary' ? await ctx.deps.fetchLatestMessage?.(args.port) ?? null : null;
    return auditTool(ctx.store, {
        tool: 'dashboard.inspect_instance',
        ok: true,
        message: `Inspected worker :${args.port}.`,
        port: args.port,
        data: { instance, latest },
        sourceLabels: ['dashboard'],
    });
}

export async function getInstanceActivity(ctx: JawCeoCoordinatorContext, args: { port: number; limit?: number | undefined }): Promise<JawCeoToolResult> {
    const depth = Math.max(1, Math.min(args.limit ?? 10, 50));
    const inspected = await inspectInstance(ctx, { port: args.port, depth: 'latest' });
    return {
        ...inspected,
        tool: 'dashboard.get_instance_activity',
        data: { ...(inspected.data as Record<string, unknown> | undefined), limit: depth },
    };
}

export async function message(ctx: JawCeoCoordinatorContext, input: JawCeoMessageInput): Promise<JawCeoToolResult<{ response: string; pending: JawCeoCompletion[] }>> {
    const text = input.text.trim();
    if (!text) {
        return auditTool(ctx.store, {
            tool: 'ceo.message',
            ok: false,
            code: 'empty_message',
            message: 'message text is required',
            sourceLabels: ['dashboard'],
        });
    }
    const selectedPort = input.selectedPort ?? (input.selectedPort === null ? null : ctx.store.getSession().selectedPort), responseMode = input.responseMode || 'text';
    ctx.store.updateSession({
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        inputMode: input.inputMode || 'text',
        responseMode,
        selectedPort: selectedPort ?? null,
    });
    if (selectedPort != null) {
        const dispatchRef = `dispatch_${randomUUID()}`;
        const result = await sendMessage(ctx, {
            port: selectedPort,
            message: text,
            dispatchRef,
            sourceChannel: input.inputMode === 'voice' ? 'ceo_voice' : 'ceo_text',
            responseMode,
            watchCompletion: true,
        });
        const response = result.ok
            ? `Sent to worker :${selectedPort} and registered a completion watch.`
            : `I could not send to worker :${selectedPort}: ${result.error?.message || 'unknown error'}`;
        return auditTool(ctx.store, {
            tool: 'ceo.message',
            ok: result.ok,
            code: result.ok ? undefined : result.error?.code,
            message: response,
            port: selectedPort,
            data: { response, pending: ctx.store.listPending() },
            sourceLabels: ['dashboard'],
        });
    }
    const response = 'Jaw CEO is ready. Select a worker or ask a dashboard question.';
    return auditTool(ctx.store, {
        tool: 'ceo.message',
        ok: true,
        message: response,
        data: { response, pending: ctx.store.listPending() },
        sourceLabels: ['dashboard'],
    });
}

function auditSendFailure(ctx: JawCeoCoordinatorContext, code: string, message: string, port?: number | undefined): JawCeoToolResult {
    return auditTool(ctx.store, {
        tool: 'instance.send_message',
        ok: false,
        code,
        message,
        ...(port !== undefined ? { port } : {}),
        sourceLabels: ['dashboard'],
    });
}

async function buildLatestMessageFallback(ctx: JawCeoCoordinatorContext, port: number, enabled: boolean): Promise<JawCeoLatestMessageFallback> {
    if (!enabled || !ctx.deps.fetchLatestMessage) return { mode: 'disabled' };
    try {
        const latest = await ctx.deps.fetchLatestMessage(port);
        const latestId = latest?.latestAssistant?.id;
        return typeof latestId === 'number' && Number.isInteger(latestId)
            ? { mode: 'enabled', sinceMessageId: latestId }
            : { mode: 'disabled' };
    } catch {
        return { mode: 'disabled' };
    }
}

async function registerOptionalWatch(ctx: JawCeoCoordinatorContext, args: {
    port: number;
    dispatchRef: string;
    sourceChannel: 'ceo_text' | 'ceo_voice';
    watchCompletion: boolean;
}): Promise<void> {
    if (!args.watchCompletion) return;
    const fallback = await buildLatestMessageFallback(ctx, args.port, true);
    await watchCompletion(ctx, {
        port: args.port,
        dispatchRef: args.dispatchRef,
        reason: args.sourceChannel === 'ceo_voice' ? 'voice_started_task' : 'ceo_routed_task',
        latestMessageFallback: fallback,
    });
}

export async function watchCompletion(ctx: JawCeoCoordinatorContext, args: {
    port: number;
    dispatchRef: string;
    reason: JawCeoWatchReason;
    latestMessageFallback: JawCeoLatestMessageFallback;
    sessionId?: string | undefined;
    autoRead?: boolean | undefined;
}): Promise<JawCeoToolResult<JawCeoWatch>> {
    if (!isPositivePort(args.port)) {
        return auditTool(ctx.store, {
            tool: 'instance.watch_completion',
            ok: false,
            code: 'invalid_port',
            message: 'port must be a positive integer',
            sourceLabels: ['dashboard'],
        });
    }
    const session = ctx.store.getSession();
    const watch: JawCeoWatch = {
        watchId: `watch_${randomUUID()}`,
        dispatchRef: args.dispatchRef,
        port: args.port,
        reason: args.reason,
        latestMessageFallback: args.latestMessageFallback,
        ...(args.sessionId ? { sessionId: args.sessionId } : { sessionId: session.sessionId }),
        autoRead: args.autoRead ?? session.autoRead,
        createdAt: nowIso(ctx.now),
        lastUserActivityAt: session.lastUserActivityAt,
    };
    ctx.store.addWatch(watch);
    return auditTool(ctx.store, {
        tool: 'instance.watch_completion',
        ok: true,
        message: `Watching worker :${args.port}.`,
        port: args.port,
        data: watch,
        sourceLabels: ['dashboard'],
    });
}

export async function sendMessage(ctx: JawCeoCoordinatorContext, args: {
    port: number;
    message: string;
    dispatchRef?: string | undefined;
    sourceChannel: 'ceo_text' | 'ceo_voice';
    responseMode: JawCeoResponseMode;
    watchCompletion: boolean;
    reason?: string | undefined;
}): Promise<JawCeoToolResult> {
    if (!isPositivePort(args.port)) {
        return auditSendFailure(ctx, 'invalid_port', 'port must be a positive integer');
    }
    if (!args.message.trim()) {
        return auditSendFailure(ctx, 'empty_message', 'message is required', args.port);
    }
    const dispatchRef = args.dispatchRef || `dispatch_${randomUUID()}`;
    await registerOptionalWatch(ctx, { port: args.port, dispatchRef, sourceChannel: args.sourceChannel, watchCompletion: args.watchCompletion });
    if (!ctx.deps.sendWorkerMessage) {
        return auditSendFailure(ctx, 'worker_send_unavailable', 'worker send adapter is unavailable in this host', args.port);
    }
    const prompt = `[from: Jaw CEO]\n${args.message.trim()}`;
    try {
        const sent = await ctx.deps.sendWorkerMessage({
            port: args.port,
            prompt,
            sourceChannel: args.sourceChannel,
            responseMode: args.responseMode,
        });
        return auditTool(ctx.store, {
            tool: 'instance.send_message',
            ok: sent.ok,
            code: sent.ok ? undefined : 'worker_send_failed',
            message: sent.message || (sent.ok ? `Sent message to worker :${args.port}.` : `Worker :${args.port} rejected the message.`),
            port: args.port,
            data: { dispatchRef, response: sent.data },
            sourceLabels: ['dashboard', `worker:${args.port}`],
        });
    } catch (error) {
        return auditTool(ctx.store, {
            tool: 'instance.send_message',
            ok: false,
            code: 'worker_send_failed',
            message: (error as Error).message,
            port: args.port,
            sourceLabels: ['dashboard', `worker:${args.port}`],
        });
    }
}

import { randomUUID } from 'node:crypto';
import { editDocs, query, runLifecycleTool } from './coordinator-admin.js';
import { continueCompletion } from './coordinator-completions.js';
import type { JawCeoCoordinatorContext } from './coordinator-types.js';
import { auditTool, isPositivePort } from './coordinator-utils.js';
import { getInstanceActivity, inspectInstance, listInstances, sendMessage, watchCompletion } from './coordinator-workers.js';
import type { JawCeoLatestMessageFallback, JawCeoToolResult } from './types.js';

export async function executeRealtimeTool(ctx: JawCeoCoordinatorContext, name: string, rawArgs: unknown): Promise<JawCeoToolResult> {
    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs as Record<string, unknown> : {};
    const dashboardResult = await executeDashboardTool(ctx, name, args);
    if (dashboardResult) return dashboardResult;
    const instanceResult = await executeInstanceTool(ctx, name, args);
    if (instanceResult) return instanceResult;
    const ceoResult = await executeCeoTool(ctx, name, args);
    if (ceoResult) return ceoResult;
    return auditTool(ctx.store, {
        tool: name,
        ok: false,
        code: 'unknown_tool',
        message: `Unknown Jaw CEO Realtime tool: ${name}`,
        kind: 'policy',
        sourceLabels: ['realtime'],
    });
}

async function executeDashboardTool(ctx: JawCeoCoordinatorContext, name: string, args: Record<string, unknown>): Promise<JawCeoToolResult | null> {
    if (name === 'dashboard.list_instances') return await listInstances(ctx, { includeHidden: args["includeHidden"] === true });
    if (name === 'dashboard.get_instance_activity') return await getInstanceActivity(ctx, { port: Number(args["port"]), limit: Number(args["limit"] || 10) });
    if (name !== 'dashboard.inspect_instance') return null;
    return await inspectInstance(ctx, {
        port: Number(args["port"]),
        depth: args["depth"] === 'summary' || args["depth"] === 'latest' || args["depth"] === 'recent' ? args["depth"] : 'recent',
    });
}

async function executeInstanceTool(ctx: JawCeoCoordinatorContext, name: string, args: Record<string, unknown>): Promise<JawCeoToolResult | null> {
    if (name === 'instance.send_message') {
        return await sendMessage(ctx, {
            port: Number(args["port"]),
            message: String(args["message"] || ''),
            dispatchRef: typeof args["dispatchRef"] === 'string' ? args["dispatchRef"] : undefined,
            sourceChannel: args["sourceChannel"] === 'ceo_text' ? 'ceo_text' : 'ceo_voice',
            responseMode: args["responseMode"] === 'text' || args["responseMode"] === 'voice' || args["responseMode"] === 'both' || args["responseMode"] === 'silent'
                ? args["responseMode"]
                : 'voice',
            watchCompletion: args["watchCompletion"] !== false,
        });
    }
    if (name === 'instance.watch_completion') {
        return await watchCompletion(ctx, {
            port: Number(args["port"]),
            dispatchRef: String(args["dispatchRef"] || `dispatch_${randomUUID()}`),
            reason: args["reason"] === 'voice_started_task' || args["reason"] === 'manual_watch' || args["reason"] === 'ceo_routed_task'
                ? args["reason"]
                : 'manual_watch',
            latestMessageFallback: typeof args["latestMessageFallback"] === 'object' && args["latestMessageFallback"]
                ? args["latestMessageFallback"] as JawCeoLatestMessageFallback
                : { mode: 'disabled' },
            ...(typeof args["sessionId"] === 'string' ? { sessionId: args["sessionId"] } : {}),
            ...(typeof args["autoRead"] === 'boolean' ? { autoRead: args["autoRead"] } : {}),
        });
    }
    if (name === 'instance.start' || name === 'instance.restart' || name === 'instance.stop' || name === 'instance.request_perm') {
        return await runLifecycleTool(ctx, {
            action: name,
            port: Number(args["port"]),
            reason: String(args["reason"] || 'Jaw CEO lifecycle request'),
            ...(typeof args["permission"] === 'string' ? { permission: args["permission"] } : {}),
            ...(typeof args["confirmationRecordId"] === 'string' ? { confirmationRecordId: args["confirmationRecordId"] } : {}),
        });
    }
    return null;
}

async function executeCeoTool(ctx: JawCeoCoordinatorContext, name: string, args: Record<string, unknown>): Promise<JawCeoToolResult | null> {
    if (name === 'ceo.get_pending_completions') {
        return auditTool(ctx.store, {
            tool: name,
            ok: true,
            message: 'Listed pending completions.',
            data: ctx.store.listPending().slice(0, Number(args["limit"] || 20)),
            sourceLabels: ['dashboard'],
        });
    }
    if (name === 'ceo.continue_completion') {
        const mode = args["mode"] === 'voice' || args["mode"] === 'both' || args["mode"] === 'silent' ? args["mode"] : 'text';
        return continueCompletion(ctx, String(args["completionKey"] || ''), mode);
    }
    if (name === 'ceo.query') {
        return await query(ctx, {
            source: args["source"] === 'cli_readonly' || args["source"] === 'web' || args["source"] === 'github_read' ? args["source"] : 'dashboard',
            query: String(args["query"] || ''),
            ...(isPositivePort(Number(args["port"])) ? { port: Number(args["port"]) } : {}),
            ...(Number.isInteger(Number(args["limit"])) ? { limit: Number(args["limit"]) } : {}),
        });
    }
    if (name === 'ceo.edit_docs') {
        return await editDocs(ctx, {
            path: String(args["path"] || ''),
            operation: args["operation"] === 'replace_section' || args["operation"] === 'apply_patch' ? args["operation"] : 'append_section',
            content: String(args["content"] || ''),
            reason: String(args["reason"] || 'Jaw CEO docs edit'),
        });
    }
    return null;
}

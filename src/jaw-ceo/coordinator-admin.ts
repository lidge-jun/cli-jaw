import { createConfirmationRecord, hashConfirmationArgs, validateConfirmationRecord } from './confirmations.js';
import type { JawCeoCoordinatorContext, JawCeoLifecycleAction, JawCeoVoiceSessionRecord } from './coordinator-types.js';
import { auditTool, nowIso, runReadonlyCli, safeJson } from './coordinator-utils.js';
import { inspectInstance, listInstances } from './coordinator-workers.js';
import { applyJawCeoDocsEdit } from './docs-edit.js';
import { canAutoVoiceResume, requireConfirmation } from './policy.js';
import type { JawCeoCompletion, JawCeoToolResult } from './types.js';

export async function query(ctx: JawCeoCoordinatorContext, args: {
    source: 'dashboard' | 'cli_readonly' | 'web' | 'github_read';
    query: string;
    port?: number | undefined;
    limit?: number | undefined;
}): Promise<JawCeoToolResult> {
    const queryText = args.query.trim();
    if (!queryText) {
        return auditTool(ctx.store, {
            tool: 'ceo.query',
            ok: false,
            code: 'empty_query',
            message: 'query is required',
            kind: 'policy',
            sourceLabels: [args.source],
        });
    }
    if (args.source === 'dashboard') {
        return await queryDashboard(ctx, args.port);
    }
    if (args.source === 'cli_readonly' || args.source === 'github_read') {
        return await queryReadonly(ctx, queryText, args.source);
    }
    return auditTool(ctx.store, {
        tool: 'ceo.query',
        ok: false,
        code: 'web_query_requires_worker',
        message: 'Web query is routed to an implementation worker; CEO direct web mutation is disabled.',
        kind: 'policy',
        sourceLabels: ['web'],
    });
}

async function queryDashboard(ctx: JawCeoCoordinatorContext, port?: number | undefined): Promise<JawCeoToolResult> {
    const data = port ? await inspectInstance(ctx, { port, depth: 'recent' }) : await listInstances(ctx);
    return auditTool(ctx.store, {
        tool: 'ceo.query',
        ok: data.ok,
        message: data.ok ? 'Dashboard query completed.' : data.error?.message || 'Dashboard query failed.',
        data: data.data,
        sourceLabels: ['dashboard'],
        untrustedText: safeJson(data.data),
    });
}

async function queryReadonly(ctx: JawCeoCoordinatorContext, queryText: string, source: 'cli_readonly' | 'github_read'): Promise<JawCeoToolResult> {
    try {
        const output = await runReadonlyCli(queryText, ctx.repoRoot);
        return auditTool(ctx.store, {
            tool: 'ceo.query',
            ok: true,
            message: 'Read-only query completed.',
            data: { output },
            sourceLabels: [source],
            untrustedText: output,
        });
    } catch (error) {
        return auditTool(ctx.store, {
            tool: 'ceo.query',
            ok: false,
            code: (error as { code?: string }).code || 'query_failed',
            message: (error as Error).message,
            kind: 'policy',
            sourceLabels: [source],
        });
    }
}

export async function editDocs(ctx: JawCeoCoordinatorContext, args: {
    path: string;
    operation: 'append_section' | 'replace_section' | 'apply_patch';
    content: string;
    reason: string;
}): Promise<JawCeoToolResult> {
    try {
        const result = await applyJawCeoDocsEdit({
            targetPath: args.path,
            operation: args.operation,
            content: args.content,
            policy: ctx.docsPolicy,
        });
        return auditTool(ctx.store, {
            tool: 'ceo.edit_docs',
            ok: true,
            message: `Edited approved docs file: ${result.path}`,
            data: result,
            kind: 'docs_edit',
            sourceLabels: ['filesystem'],
            meta: { reason: args.reason, operation: args.operation, path: result.path },
        });
    } catch (error) {
        return auditTool(ctx.store, {
            tool: 'ceo.edit_docs',
            ok: false,
            code: (error as { code?: string }).code || 'docs_edit_failed',
            message: (error as Error).message,
            kind: 'policy',
            sourceLabels: ['filesystem'],
            meta: { reason: args.reason, operation: args.operation, path: args.path },
        });
    }
}

export function createConfirmation(ctx: JawCeoCoordinatorContext, args: {
    action: string;
    targetPort?: number | undefined;
    sessionId?: string | undefined;
    argsHash?: string | undefined;
    expiresInMs?: number | undefined;
}): JawCeoToolResult {
    const sessionId = args.sessionId || ctx.store.getSession().sessionId;
    const record = createConfirmationRecord({
        action: args.action,
        argsHash: args.argsHash || hashConfirmationArgs({ action: args.action, targetPort: args.targetPort }),
        ...(args.targetPort !== undefined ? { targetPort: args.targetPort } : {}),
        sessionId,
        now: ctx.now(),
        ...(args.expiresInMs !== undefined ? { expiresInMs: args.expiresInMs } : {}),
    });
    ctx.store.addConfirmation(record);
    return auditTool(ctx.store, {
        tool: 'ceo.create_confirmation',
        ok: true,
        message: `Confirmation created for ${args.action}.`,
        data: record,
        kind: 'policy',
        ...(args.targetPort !== undefined ? { port: args.targetPort } : {}),
        sourceLabels: ['dashboard'],
    });
}

export function confirmConfirmation(ctx: JawCeoCoordinatorContext, confirmationId: string, args: { sessionId?: string | undefined; reason?: string | undefined } = {}): JawCeoToolResult {
    void args.reason;
    const record = ctx.store.getConfirmation(confirmationId);
    if (!record) {
        return auditTool(ctx.store, {
            tool: 'ceo.confirm_confirmation',
            ok: false,
            code: 'confirmation_not_found',
            message: 'confirmation token was not found',
            kind: 'policy',
            sourceLabels: ['dashboard'],
        });
    }
    const validation = validateConfirmationRecord({
        record,
        action: record.action,
        argsHash: record.argsHash,
        ...(record.targetPort !== undefined ? { targetPort: record.targetPort } : {}),
        sessionId: args.sessionId || record.sessionId,
        now: ctx.now(),
    });
    if (!validation.ok) {
        return auditTool(ctx.store, {
            tool: 'ceo.confirm_confirmation',
            ok: false,
            code: validation.code,
            message: validation.message,
            kind: 'policy',
            ...(record.targetPort !== undefined ? { port: record.targetPort } : {}),
            sourceLabels: ['dashboard'],
        });
    }
    const consumed = ctx.store.updateConfirmation(record.id, { consumedAt: nowIso(ctx.now) });
    return auditTool(ctx.store, {
        tool: 'ceo.confirm_confirmation',
        ok: true,
        message: `Confirmation consumed for ${record.action}.`,
        data: consumed,
        kind: 'policy',
        ...(record.targetPort !== undefined ? { port: record.targetPort } : {}),
        sourceLabels: ['dashboard'],
    });
}

export function cancelConfirmation(ctx: JawCeoCoordinatorContext, confirmationId: string, reason?: string | undefined): JawCeoToolResult {
    const record = ctx.store.updateConfirmation(confirmationId, { cancelledAt: nowIso(ctx.now) });
    if (!record) {
        return auditTool(ctx.store, {
            tool: 'ceo.cancel_confirmation',
            ok: false,
            code: 'confirmation_not_found',
            message: 'confirmation token was not found',
            kind: 'policy',
            sourceLabels: ['dashboard'],
        });
    }
    return auditTool(ctx.store, {
        tool: 'ceo.cancel_confirmation',
        ok: true,
        message: reason || `Confirmation cancelled for ${record.action}.`,
        data: record,
        kind: 'policy',
        ...(record.targetPort !== undefined ? { port: record.targetPort } : {}),
        sourceLabels: ['dashboard'],
    });
}

export async function runLifecycleTool(ctx: JawCeoCoordinatorContext, args: {
    action: 'instance.start' | 'instance.restart' | 'instance.stop' | 'instance.request_perm';
    port: number;
    reason: string;
    permission?: string | undefined;
    confirmationRecordId?: string | undefined;
}): Promise<JawCeoToolResult> {
    const lifecycleAction = resolveLifecycleAction(args.action);
    const sessionId = ctx.store.getSession().sessionId;
    const argsHash = buildLifecycleArgsHash(args);
    const confirmation = validateLifecycleConfirmation(ctx, { ...args, argsHash, sessionId });
    if (!confirmation.ok) return confirmation.result;
    if (!ctx.deps.runLifecycleAction) {
        return auditTool(ctx.store, {
            tool: args.action,
            ok: false,
            code: 'lifecycle_unavailable',
            message: 'lifecycle adapter is unavailable in this host',
            port: args.port,
            kind: 'lifecycle',
            sourceLabels: ['dashboard'],
        });
    }
    const result = await ctx.deps.runLifecycleAction({
        action: lifecycleAction,
        port: args.port,
        reason: args.reason,
    });
    return auditTool(ctx.store, {
        tool: args.action,
        ok: result.ok,
        code: result.ok ? undefined : 'lifecycle_failed',
        message: result.message,
        port: args.port,
        data: result.data,
        kind: 'lifecycle',
        sourceLabels: ['dashboard'],
    });
}

function resolveLifecycleAction(action: 'instance.start' | 'instance.restart' | 'instance.stop' | 'instance.request_perm'): JawCeoLifecycleAction {
    return action === 'instance.request_perm' ? 'perm' : action.replace('instance.', '') as JawCeoLifecycleAction;
}

function buildLifecycleArgsHash(args: {
    action: string;
    port: number;
    reason: string;
    permission?: string | undefined;
}): string {
    return hashConfirmationArgs({
        action: args.action,
        port: args.port,
        reason: args.reason,
        ...(args.permission ? { permission: args.permission } : {}),
    });
}

function lifecyclePolicyFailure(ctx: JawCeoCoordinatorContext, action: string, port: number, code: string, message: string): JawCeoToolResult {
    return auditTool(ctx.store, {
        tool: action,
        ok: false,
        code,
        message,
        port,
        kind: 'policy',
        sourceLabels: ['dashboard'],
    });
}

function validateLifecycleConfirmation(ctx: JawCeoCoordinatorContext, args: {
    action: 'instance.start' | 'instance.restart' | 'instance.stop' | 'instance.request_perm';
    port: number;
    reason: string;
    sessionId: string;
    argsHash: string;
    confirmationRecordId?: string | undefined;
}): { ok: true } | { ok: false; result: JawCeoToolResult } {
    const confirmation = requireConfirmation({
        action: args.action,
        argsHash: args.argsHash,
        targetPort: args.port,
        sessionId: args.sessionId,
        confirmationRecordId: args.confirmationRecordId,
    });
    if (!confirmation.ok) {
        return { ok: false, result: lifecyclePolicyFailure(ctx, args.action, args.port, confirmation.code, confirmation.message) };
    }
    if (!args.confirmationRecordId) return { ok: true };
    const recordValidation = validateConfirmationRecord({
        record: ctx.store.getConfirmation(args.confirmationRecordId),
        action: args.action,
        argsHash: args.argsHash,
        targetPort: args.port,
        sessionId: args.sessionId,
        now: ctx.now(),
    });
    if (!recordValidation.ok) {
        return { ok: false, result: lifecyclePolicyFailure(ctx, args.action, args.port, recordValidation.code, recordValidation.message) };
    }
    ctx.store.updateConfirmation(args.confirmationRecordId, { consumedAt: nowIso(ctx.now) });
    return { ok: true };
}

export function canAutoResumeVoiceForCompletion(ctx: JawCeoCoordinatorContext, completion: JawCeoCompletion, documentVisible: boolean): boolean {
    const watch = ctx.store.findWatch(completion.watchId);
    if (!watch) return false;
    return canAutoVoiceResume({
        lastUserActivityAt: watch.lastUserActivityAt,
        documentVisible,
        autoRead: watch.autoRead,
        now: ctx.now(),
    });
}

export function registerVoiceSession(ctx: JawCeoCoordinatorContext, record: JawCeoVoiceSessionRecord): void {
    ctx.voiceSessions.set(record.sessionId, record);
    ctx.store.updateVoice({ status: 'active', sessionId: record.sessionId, error: null });
}

export function closeVoiceSession(ctx: JawCeoCoordinatorContext, sessionId: string): JawCeoToolResult {
    const record = ctx.voiceSessions.get(sessionId);
    if (record) {
        record.close();
        ctx.voiceSessions.delete(sessionId);
    }
    ctx.store.updateVoice({ status: 'sleeping', sessionId: null, error: null });
    return auditTool(ctx.store, {
        tool: 'ceo.voice.close',
        ok: true,
        message: `Closed Jaw CEO voice session ${sessionId}.`,
        sourceLabels: ['realtime'],
    });
}

import type { Request } from 'express';
import { verifyBossToken } from '../core/boss-auth.js';
import { settings } from '../core/config.js';
import { createChatSession, getChatSessionById } from '../core/chat-sessions.js';
import { getCurrentMainMeta } from '../agent/spawn.js';
import { getCtx, getState, type OrcStateName, type OrcContext } from './state-machine.js';
import { resolveOrcScope, scopeForChatSession } from './scope.js';
import { getWorkerSlot, type WorkerReplayMeta } from './worker-registry.js';
import { stripUndefined } from '../core/strip-undefined.js';

export type DispatchMode = 'full' | 'boss';
export type DispatchAccessPath = 'direct' | 'boss' | 'approval';
export type CapturedPermissions = string | string[];

export type DispatchAuth =
    | { ok: true; mode: DispatchMode }
    | { ok: false; status: 403; error: 'dispatch_forbidden' };

export type DispatchFail =
    | { ok: false; status: 400; error: 'dispatch_context_invalid' | 'dispatch_context_required' | 'dispatch_mutable_forbidden' | 'dispatch_policy_invalid' | 'delegation_guard'; message?: string }
    | { ok: false; status: 403; error: 'dispatch_forbidden' | 'dispatch_no_descendants' }
    | { ok: false; status: 409; error: 'dispatch_context_conflict' | 'dispatch_context_not_found' };

export type DispatchContext = {
    mode: DispatchMode;
    fullAccess: boolean;
    permissions?: CapturedPermissions;
    scopeKey: string;
    chatSessionId: string;
    parentRequestId?: string;
    workingDir: string | null;
    projectDirs: string[] | null;
    origin: string;
    replayMeta: WorkerReplayMeta;
    plan: string | null;
    orcContext: OrcContext | null;
    worklogPath?: string;
    orcState: OrcStateName;
    parentMutableFalse: boolean;
    parentNoDescendants: boolean;
    parentScope?: string | null;
};

export type DispatchAssignment = DispatchContext & {
    allowWrite: boolean;
    allowDispatch: boolean;
    noDescendants: boolean;
    resolvedPhase: number;
    scope: string | null;
};

type HeaderBag = Request['headers'] | Record<string, unknown>;

const SELECTOR_MAX = 200;
const PABCD_PHASE_MAP: Record<string, number> = { A: 2, B: 4, C: 4 };
const READONLY_EMPLOYEE_PHASES = new Set([1, 2, 4]);

export function headerValue(headers: HeaderBag | undefined, name: string): string {
    if (!headers) return '';
    const record = headers as Record<string, unknown>;
    const raw = record[name] ?? record[name.toLowerCase()];
    if (Array.isArray(raw)) return String(raw[0] || '');
    return raw == null ? '' : String(raw);
}

export function isEmployeeDispatchRequest(req: { headers?: HeaderBag }): boolean {
    return headerValue(req.headers, 'x-jaw-employee-mode') === '1';
}

export function hasValidBossToken(req: { headers?: HeaderBag }): boolean {
    return verifyBossToken(headerValue(req.headers, 'x-jaw-boss-token'));
}

function cloneProjectDirs(value: unknown): string[] | null {
    return Array.isArray(value) && value.every((d): d is string => typeof d === 'string') ? [...value] : null;
}

export function clonePermissions(value: unknown): CapturedPermissions | undefined {
    if (typeof value === 'string' && value.length > 0) return value;
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        return [...value];
    }
    return undefined;
}

export function authorizeDispatch(
    req: { headers?: HeaderBag },
    isFullAccess: (req: Request) => boolean,
): DispatchAuth {
    if (isFullAccess(req as Request) === true) return { ok: true, mode: 'full' };
    if (hasValidBossToken(req)) return { ok: true, mode: 'boss' };
    return { ok: false, status: 403, error: 'dispatch_forbidden' };
}

export function dispatchAccessPath(
    req: { headers?: HeaderBag },
    fullAccess: boolean,
): DispatchAccessPath {
    if (fullAccess === true) return 'direct';
    if (hasValidBossToken(req)) return 'boss';
    return 'approval';
}

type SelectorRead =
    | { ok: true; present: false }
    | { ok: true; present: true; scopeKey: string; chatSessionId: string; requestId: string }
    | DispatchFail;

function readOneSelector(value: unknown): { kind: 'absent' } | { kind: 'invalid' } | { kind: 'value'; value: string } {
    if (value === undefined || value === null) return { kind: 'absent' };
    if (typeof value !== 'string') return { kind: 'invalid' };
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > SELECTOR_MAX) return { kind: 'invalid' };
    return { kind: 'value', value: trimmed };
}

export function readSelectors(body: Record<string, unknown> | null | undefined): SelectorRead {
    const source = body || {};
    const scopeKey = readOneSelector(source['scopeKey']);
    const chatSessionId = readOneSelector(source['chatSessionId']);
    const requestId = readOneSelector(source['requestId']);
    const presentCount = [scopeKey, chatSessionId, requestId].filter((item) => item.kind !== 'absent').length;
    if (presentCount === 0) return { ok: true, present: false };
    if (scopeKey.kind === 'invalid' || chatSessionId.kind === 'invalid' || requestId.kind === 'invalid') {
        return { ok: false, status: 400, error: 'dispatch_context_invalid' };
    }
    if (scopeKey.kind !== 'value' || chatSessionId.kind !== 'value' || requestId.kind !== 'value') {
        return { ok: false, status: 400, error: 'dispatch_context_invalid' };
    }
    return {
        ok: true,
        present: true,
        scopeKey: scopeKey.value,
        chatSessionId: chatSessionId.value,
        requestId: requestId.value,
    };
}

function chatExists(id: string): boolean {
    return id === 'default' || getChatSessionById(id) !== null;
}

function copyDelivery(meta: WorkerReplayMeta): WorkerReplayMeta {
    const out: WorkerReplayMeta = {};
    if (meta.origin !== undefined) out.origin = meta.origin;
    if (meta.target !== undefined) out.target = meta.target;
    if (meta.chatId !== undefined) out.chatId = meta.chatId;
    if (meta.requestId !== undefined) out.requestId = meta.requestId;
    if (meta.replyViaTarget !== undefined) out.replyViaTarget = meta.replyViaTarget;
    if (meta.scopeId !== undefined) out.scopeId = meta.scopeId;
    if (meta.chatSessionId !== undefined) out.chatSessionId = meta.chatSessionId;
    if (meta.remoteKey !== undefined) out.remoteKey = meta.remoteKey;
    const permissions = clonePermissions(meta.permissions);
    if (permissions !== undefined) out.permissions = permissions;
    if (meta.mutable !== undefined) out.mutable = meta.mutable;
    if (meta.noDescendants !== undefined) out.noDescendants = meta.noDescendants;
    if (meta.fullAccess !== undefined) out.fullAccess = meta.fullAccess;
    return out;
}

function dispatchContext(input: DispatchContext): DispatchContext {
    const out: DispatchContext = {
        mode: input.mode,
        fullAccess: input.fullAccess,
        scopeKey: input.scopeKey,
        chatSessionId: input.chatSessionId,
        workingDir: input.workingDir,
        projectDirs: input.projectDirs,
        origin: input.origin,
        replayMeta: input.replayMeta,
        plan: input.plan,
        orcContext: input.orcContext,
        orcState: input.orcState,
        parentMutableFalse: input.parentMutableFalse,
        parentNoDescendants: input.parentNoDescendants,
    };
    if (input.permissions !== undefined) out.permissions = input.permissions;
    if (input.parentRequestId !== undefined) out.parentRequestId = input.parentRequestId;
    if (input.parentScope !== undefined) out.parentScope = input.parentScope;
    if (input.worklogPath !== undefined) out.worklogPath = input.worklogPath;
    return out;
}

function deliveryFromMain(main: {
    origin: string;
    target?: WorkerReplayMeta['target'];
    chatId?: string | number;
    requestId?: string;
    replyViaTarget?: boolean;
    scopeId?: string;
    chatSessionId?: string;
    remoteKey?: string;
    permissions?: CapturedPermissions;
}, scopeKey: string, chatSessionId: string): WorkerReplayMeta {
    const out: WorkerReplayMeta = {
        origin: main.origin || 'web',
        scopeId: main.scopeId || scopeKey,
        chatSessionId: main.chatSessionId || chatSessionId,
    };
    if (main.target !== undefined) out.target = main.target;
    if (main.chatId !== undefined) out.chatId = main.chatId;
    if (main.requestId !== undefined) out.requestId = main.requestId;
    if (main.replyViaTarget !== undefined) out.replyViaTarget = main.replyViaTarget;
    if (main.remoteKey !== undefined) out.remoteKey = main.remoteKey;
    const permissions = clonePermissions(main.permissions);
    if (permissions !== undefined) out.permissions = permissions;
    return out;
}

export function resolveSelectedContext(sel: {
    scopeKey: string;
    chatSessionId: string;
    requestId: string;
}): { ok: true; ctx: DispatchContext } | DispatchFail {
    if (!chatExists(sel.chatSessionId)) {
        return { ok: false, status: 409, error: 'dispatch_context_not_found' };
    }

    const slot = getWorkerSlot(sel.requestId);
    const slotMeta = slot?.replayMeta;
    const slotMatch = Boolean(slot && slot.state === 'running' && slot.runId === sel.requestId && slotMeta
        && slotMeta.scopeId === sel.scopeKey
        && slotMeta.chatSessionId === sel.chatSessionId
        && (slot.runId === sel.requestId || slotMeta.requestId === sel.requestId));

    const main = getCurrentMainMeta(sel.scopeKey);
    const mainMatch = Boolean(main
        && main.chatSessionId === sel.chatSessionId
        && main.requestId === sel.requestId);

    if (slotMatch && mainMatch) return { ok: false, status: 409, error: 'dispatch_context_conflict' };
    if (!slotMatch && !mainMatch) {
        return { ok: false, status: 409, error: slot || main ? 'dispatch_context_conflict' : 'dispatch_context_not_found' };
    }

    const orcCtx = getCtx(sel.scopeKey);
    const orcState = getState(sel.scopeKey);
    if (slotMatch && slot && slotMeta) {
        const slotPerms = clonePermissions(slotMeta.permissions) ?? clonePermissions(settings['permissions']);
        return {
            ok: true,
            ctx: dispatchContext({
                mode: 'full',
                fullAccess: true,
                scopeKey: sel.scopeKey,
                chatSessionId: sel.chatSessionId,
                parentRequestId: sel.requestId,
                workingDir: slotMeta.workingDir !== undefined ? slotMeta.workingDir : orcCtx?.workingDir ?? settings['workingDir'] ?? null,
                projectDirs: slotMeta.projectDirs !== undefined ? cloneProjectDirs(slotMeta.projectDirs) : cloneProjectDirs(orcCtx?.projectDirs ?? settings['projectDirs']),
                origin: slotMeta.origin || 'cli',
                replayMeta: copyDelivery({ ...slotMeta, scopeId: sel.scopeKey, chatSessionId: sel.chatSessionId, requestId: sel.requestId }),
                plan: orcCtx?.plan ?? null,
                orcContext: orcCtx ? structuredClone(orcCtx) : null,
                orcState,
                parentMutableFalse: slotMeta.mutable === false,
                ...(slotMeta.scope !== undefined ? { parentScope: slotMeta.scope } : {}),
                parentNoDescendants: slotMeta.noDescendants === true,
                ...(slotPerms !== undefined ? { permissions: slotPerms } : {}),
                ...(orcCtx?.worklogPath ? { worklogPath: orcCtx.worklogPath } : {}),
            }),
        };
    }

    const matchedMain = main!;
    const mainPerms = clonePermissions(matchedMain.permissions) ?? clonePermissions(settings['permissions']);
    return {
        ok: true,
        ctx: dispatchContext({
            mode: 'full',
            fullAccess: true,
            scopeKey: sel.scopeKey,
            chatSessionId: sel.chatSessionId,
            parentRequestId: sel.requestId,
            workingDir: orcCtx?.workingDir ?? settings['workingDir'] ?? null,
            projectDirs: cloneProjectDirs(orcCtx?.projectDirs ?? settings['projectDirs']),
            origin: matchedMain.origin || 'cli',
            replayMeta: copyDelivery(deliveryFromMain(matchedMain, sel.scopeKey, sel.chatSessionId)),
            plan: orcCtx?.plan ?? null,
            orcContext: orcCtx ? structuredClone(orcCtx) : null,
            orcState,
            parentMutableFalse: false,
            parentNoDescendants: false,
            ...(mainPerms !== undefined ? { permissions: mainPerms } : {}),
            ...(orcCtx?.worklogPath ? { worklogPath: orcCtx.worklogPath } : {}),
        }),
    };
}

const pendingIndependentBindings = new WeakSet<DispatchContext>();

export function createIndependentBinding(persist = true): DispatchContext {
    const chatSessionId = persist ? createChatSession('jaw-dispatch', { activate: false }).id : '';
    const scopeKey = chatSessionId ? scopeForChatSession(chatSessionId, undefined, true) : '';
    const independentPerms = clonePermissions(settings['permissions']);
    const ctx = dispatchContext({
        mode: 'full',
        fullAccess: true,
        scopeKey,
        chatSessionId,
        workingDir: settings['workingDir'] || null,
        projectDirs: cloneProjectDirs(settings['projectDirs']),
        origin: 'cli',
        replayMeta: { origin: 'cli', scopeId: scopeKey, chatSessionId },
        plan: null,
        orcContext: null,
        orcState: persist ? getState(scopeKey) : 'IDLE',
        parentMutableFalse: false,
        parentNoDescendants: false,
        ...(independentPerms !== undefined ? { permissions: independentPerms } : {}),
    });
    if (!persist) pendingIndependentBindings.add(ctx);
    return ctx;
}

/** Persist a standalone binding only after every request entry passed validation. */
export function admitDispatchContext(ctx: DispatchContext, assignments: DispatchAssignment[]): void {
    if (!pendingIndependentBindings.has(ctx)) return;
    const chatSessionId = createChatSession('jaw-dispatch', { activate: false }).id;
    const scopeKey = scopeForChatSession(chatSessionId, undefined, true);
    for (const target of [ctx, ...assignments]) {
        target.chatSessionId = chatSessionId;
        target.scopeKey = scopeKey;
        target.replayMeta = { ...target.replayMeta, chatSessionId, scopeId: scopeKey };
    }
    pendingIndependentBindings.delete(ctx);
}

export function loadLegacyBossContext(mode: DispatchMode): DispatchContext {
    const scopeKey = resolveOrcScope({ origin: 'web', workingDir: settings['workingDir'] || null });
    const orcCtx = getCtx(scopeKey);
    const main = getCurrentMainMeta(scopeKey);
    const chatSessionId = main?.chatSessionId || 'default';
    const legacyPerms = clonePermissions(main?.permissions) ?? clonePermissions(settings['permissions']);
    return dispatchContext({
        mode,
        fullAccess: mode === 'full',
        scopeKey,
        chatSessionId,
        workingDir: orcCtx?.workingDir ?? settings['workingDir'] ?? null,
        projectDirs: cloneProjectDirs(orcCtx?.projectDirs ?? settings['projectDirs']),
        origin: main?.origin || 'web',
        replayMeta: copyDelivery(main ? deliveryFromMain(main, scopeKey, chatSessionId) : { origin: 'web', scopeId: scopeKey, chatSessionId }),
        plan: orcCtx?.plan ?? null,
        orcContext: orcCtx ? structuredClone(orcCtx) : null,
        orcState: getState(scopeKey),
        parentMutableFalse: false,
        parentNoDescendants: false,
        ...(main?.requestId ? { parentRequestId: main.requestId } : {}),
        ...(legacyPerms !== undefined ? { permissions: legacyPerms } : {}),
        ...(orcCtx?.worklogPath ? { worklogPath: orcCtx.worklogPath } : {}),
    });
}

export function prepareDispatchContext(
    req: { headers?: HeaderBag; body?: unknown },
    isFullAccess: (req: Request) => boolean,
): { ok: true; ctx: DispatchContext } | DispatchFail {
    const auth = authorizeDispatch(req, isFullAccess);
    if (!auth.ok) return auth;
    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
    const selectors = readSelectors(body);
    if (!selectors.ok) return selectors;
    if (isEmployeeDispatchRequest(req) && !selectors.present) {
        return { ok: false, status: 400, error: 'dispatch_context_required' };
    }
    if (selectors.present) {
        const selected = resolveSelectedContext(selectors);
        if (!selected.ok) return selected;
        selected.ctx.mode = auth.mode;
        selected.ctx.fullAccess = auth.mode === 'full';
        if (selected.ctx.parentNoDescendants) {
            return { ok: false, status: 403, error: 'dispatch_no_descendants' };
        }
        return selected;
    }
    if (hasValidBossToken(req)) return { ok: true, ctx: loadLegacyBossContext(auth.mode) };
    if (auth.mode === 'full') return { ok: true, ctx: createIndependentBinding(false) };
    return { ok: false, status: 403, error: 'dispatch_forbidden' };
}

export function readOptionalBoolean(value: unknown): boolean | undefined {
    if (value === true || value === false) return value;
    return undefined;
}

export function readEmployeePhase(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

export function resolveAllowWrite(input: {
    mutable: boolean | undefined;
    parentMutableFalse: boolean;
    orcState: OrcStateName;
    bodyPhase: number | undefined;
    mode: DispatchMode;
}): { ok: true; allowWrite: boolean } | DispatchFail {
    if (input.parentMutableFalse) {
        if (input.mutable === true) return { ok: false, status: 400, error: 'dispatch_mutable_forbidden' };
        return { ok: true, allowWrite: false };
    }
    if (input.mutable === false) return { ok: true, allowWrite: false };
    if (input.mutable === true) return { ok: true, allowWrite: true };
    const auditDefault = input.orcState === 'A'
        || (input.bodyPhase !== undefined && READONLY_EMPLOYEE_PHASES.has(input.bodyPhase));
    if (auditDefault) return { ok: true, allowWrite: false };
    if (input.mode === 'full') return { ok: true, allowWrite: true };
    return { ok: true, allowWrite: false };
}

export function finishAssignment(
    ctx: DispatchContext,
    item: { mutable?: unknown; phase?: unknown; noDescendants?: unknown; scope?: unknown },
): { ok: true; assignment: DispatchAssignment } | DispatchFail {
    if (ctx.parentNoDescendants) return { ok: false, status: 403, error: 'dispatch_no_descendants' };
    if ((item.scope !== undefined && item.scope !== null && typeof item.scope !== 'string')
        || (item.mutable !== undefined && typeof item.mutable !== 'boolean')
        || (item.noDescendants !== undefined && typeof item.noDescendants !== 'boolean')
        || (item.phase !== undefined && ![1, 2, 3, 4, 5].includes(readEmployeePhase(item.phase) ?? 0))) {
        return { ok: false, status: 400, error: 'dispatch_policy_invalid' };
    }
    const mutable = readOptionalBoolean(item.mutable);
    const bodyPhase = readEmployeePhase(item.phase);
    const allowWrite = resolveAllowWrite({
        mutable,
        parentMutableFalse: ctx.parentMutableFalse,
        orcState: ctx.orcState,
        bodyPhase,
        mode: ctx.mode,
    });
    if (!allowWrite.ok) return allowWrite;
    const noDescendants = item.noDescendants === true;
    const allowDispatch = ctx.mode === 'full' && noDescendants !== true;
    const resolvedPhase = allowWrite.allowWrite
        ? 3
        : (bodyPhase ?? PABCD_PHASE_MAP[ctx.orcState] ?? 3);
    const permissions = clonePermissions(ctx.permissions);
    return {
        ok: true,
        assignment: {
            ...ctx,
            allowWrite: allowWrite.allowWrite,
            allowDispatch,
            noDescendants,
            resolvedPhase,
            scope: typeof item.scope === 'string' && item.scope ? item.scope : ctx.parentScope ?? null,
            ...(permissions !== undefined ? { permissions } : {}),
        },
    };
}

export function buildClaimReplayMeta(assignment: DispatchAssignment): WorkerReplayMeta {
    const permissions = clonePermissions(assignment.permissions);
    const independent = assignment.replayMeta.target === undefined
        && assignment.replayMeta.chatId === undefined
        && assignment.replayMeta.replyViaTarget === undefined
        && assignment.replayMeta.remoteKey === undefined
        && assignment.origin === 'cli'
        && !assignment.parentRequestId;
    return stripUndefined({
        origin: assignment.origin,
        ...(independent ? {} : {
            target: assignment.replayMeta.target,
            chatId: assignment.replayMeta.chatId,
            replyViaTarget: assignment.replayMeta.replyViaTarget,
            remoteKey: assignment.replayMeta.remoteKey,
        }),
        requestId: assignment.parentRequestId,
        scopeId: assignment.scopeKey,
        chatSessionId: assignment.chatSessionId,
        mutable: assignment.allowWrite,
        noDescendants: assignment.noDescendants,
        fullAccess: assignment.fullAccess,
        permissions,
        workingDir: assignment.workingDir,
        projectDirs: cloneProjectDirs(assignment.projectDirs),
        scope: assignment.scope,
    });
}

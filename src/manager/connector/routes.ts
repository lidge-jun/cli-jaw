import { Router, type Request, type Response } from 'express';
import { BoardStore, type DashboardTaskInput, type DashboardTaskPatch } from '../board/store.js';
import { RemindersStore } from '../reminders/store.js';
import type { DashboardReminderInput, DashboardReminderPatch } from '../reminders/store.js';
import { NotesStore } from '../notes/store.js';
import { stripUndefined } from '../../core/strip-undefined.js';
import { ConnectorAuditLog } from './audit-log.js';
import type { ConnectorAuditEvent, ConnectorInstanceLink, ConnectorSurface } from './types.js';

export type ConnectorRouterOptions = {
    boardStore?: BoardStore;
    remindersStore?: RemindersStore;
    notesStore?: NotesStore;
    auditLog?: ConnectorAuditLog;
};

function sendErr(res: Response, status: number, code: string, error: unknown): void {
    res.status(status).json({
        ok: false,
        code,
        error: error instanceof Error ? error.message : String(error),
    });
}

function pickInstanceLink(value: unknown): ConnectorInstanceLink | null {
    if (!value || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    const port = typeof obj["port"] === 'number' && Number.isFinite(obj["port"]) ? obj["port"] : null;
    const threadKey = typeof obj["threadKey"] === 'string' && obj["threadKey"].trim() ? obj["threadKey"] : null;
    const messageId = typeof obj["messageId"] === 'string' && obj["messageId"].trim() ? obj["messageId"] : null;
    if (port === null && threadKey === null && messageId === null) return null;
    return { port, threadKey, messageId };
}

function ensureUserRequested(body: Record<string, unknown>): boolean {
    return body["userRequested"] === true;
}

function recordAudit(
    auditLog: ConnectorAuditLog,
    surface: ConnectorSurface,
    action: string,
    targetId: string | null,
    instanceLink: ConnectorInstanceLink | null,
): ConnectorAuditEvent | null {
    try {
        return auditLog.append({
            surface,
            action,
            targetId,
            actor: 'agent',
            instanceLink,
        });
    } catch {
        return null;
    }
}

function pickBoardInput(body: Record<string, unknown>, link: ConnectorInstanceLink | null): DashboardTaskInput {
    const title = typeof body["title"] === 'string' ? body["title"] : '';
    return stripUndefined({
        title,
        summary: typeof body["summary"] === 'string' ? body["summary"] : null,
        detail: typeof body["detail"] === 'string' ? body["detail"] : null,
        lane: typeof body["lane"] === 'string' ? body["lane"] as DashboardTaskInput['lane'] : undefined,
        port: link?.port ?? (typeof body["port"] === 'number' ? body["port"] : null),
        threadKey: link?.threadKey ?? (typeof body["threadKey"] === 'string' ? body["threadKey"] : null),
        notePath: typeof body["notePath"] === 'string' ? body["notePath"] : null,
        source: 'connector',
    });
}

function pickBoardPatch(body: Record<string, unknown>): DashboardTaskPatch {
    const patch: DashboardTaskPatch = {};
    if (typeof body["title"] === 'string') patch.title = body["title"];
    if ('summary' in body) patch.summary = typeof body["summary"] === 'string' ? body["summary"] : null;
    if ('detail' in body) patch.detail = typeof body["detail"] === 'string' ? body["detail"] : null;
    if (typeof body["lane"] === 'string') patch.lane = body["lane"] as NonNullable<DashboardTaskPatch['lane']>;
    if ('notePath' in body) patch.notePath = typeof body["notePath"] === 'string' ? body["notePath"] : null;
    return patch;
}

function pickReminderInput(body: Record<string, unknown>, link: ConnectorInstanceLink | null): DashboardReminderInput {
    // Only forward a structured `link` when we have the required (instanceId,
    // messageId) pair. Otherwise fall back to a plain `linkedInstance` string
    // derived from the port so the connector still records which instance the
    // request came from.
    const messageId = link?.messageId ?? null;
    const linkedInstance = link?.port != null ? String(link.port) : null;
    return stripUndefined({
        title: typeof body["title"] === 'string' ? body["title"] : '',
        notes: typeof body["notes"] === 'string' ? body["notes"] : null,
        priority: typeof body["priority"] === 'string' ? body["priority"] as DashboardReminderInput['priority'] : undefined,
        dueAt: typeof body["dueAt"] === 'string' ? body["dueAt"] : null,
        remindAt: typeof body["remindAt"] === 'string' ? body["remindAt"] : null,
        linkedInstance,
        link: messageId
            ? {
                instanceId: linkedInstance ?? messageId,
                messageId,
                port: link?.port ?? null,
                threadKey: link?.threadKey ?? null,
            }
            : null,
    });
}

async function ensureNoteParentFolder(notesStore: NotesStore, relPath: string): Promise<void> {
    const segments = relPath.split('/').filter(Boolean);
    if (segments.length <= 1) return;
    for (let i = 1; i < segments.length; i++) {
        const folder = segments.slice(0, i).join('/');
        try {
            await notesStore.createFolder(folder);
        } catch (e) {
            // Ignore "already exists" so the connector stays idempotent. Re-throw any
            // path-validation error (statusCode 400 or similar) so the caller sees it.
            const code = (e as { code?: string } | null | undefined)?.code;
            if (code === 'note_path_exists') continue;
            throw e;
        }
    }
}

function pickReminderPatch(body: Record<string, unknown>): DashboardReminderPatch {
    const patch: DashboardReminderPatch = {};
    if (typeof body["title"] === 'string') patch.title = body["title"];
    if ('notes' in body) patch.notes = typeof body["notes"] === 'string' ? body["notes"] : null;
    if (typeof body["status"] === 'string') patch.status = body["status"] as DashboardReminderPatch['status'];
    if (typeof body["priority"] === 'string') patch.priority = body["priority"] as DashboardReminderPatch['priority'];
    if ('dueAt' in body) patch.dueAt = typeof body["dueAt"] === 'string' ? body["dueAt"] : null;
    if ('remindAt' in body) patch.remindAt = typeof body["remindAt"] === 'string' ? body["remindAt"] : null;
    return patch;
}

export function createDashboardConnectorRouter(options: ConnectorRouterOptions = {}): Router {
    const router = Router();
    const boardStore = options.boardStore || new BoardStore();
    const remindersStore = options.remindersStore || new RemindersStore();
    const notesStore = options.notesStore || new NotesStore();
    const auditLog = options.auditLog || new ConnectorAuditLog();

    router.post('/board', (req: Request, res: Response) => {
        const body = (req.body || {}) as Record<string, unknown>;
        if (!ensureUserRequested(body)) {
            sendErr(res, 403, 'connector_not_user_requested', 'userRequested must be true');
            return;
        }
        try {
            const link = pickInstanceLink(body["instanceLink"]);
            const task = boardStore.create(pickBoardInput(body, link));
            const audit = recordAudit(auditLog, 'board', 'create', task.id, link);
            res.status(201).json({ ok: true, task, audit });
        } catch (e) {
            sendErr(res, 400, 'connector_invalid_input', e);
        }
    });

    router.patch('/board/:id', (req: Request, res: Response) => {
        const body = (req.body || {}) as Record<string, unknown>;
        if (!ensureUserRequested(body)) {
            sendErr(res, 403, 'connector_not_user_requested', 'userRequested must be true');
            return;
        }
        try {
            const id = String(req.params["id"] || '');
            const link = pickInstanceLink(body["instanceLink"]);
            const task = boardStore.update(id, pickBoardPatch(body));
            if (!task) {
                sendErr(res, 404, 'connector_target_not_found', 'board task not found');
                return;
            }
            const audit = recordAudit(auditLog, 'board', 'update', task.id, link);
            res.json({ ok: true, task, audit });
        } catch (e) {
            sendErr(res, 400, 'connector_invalid_input', e);
        }
    });

    router.post('/reminders', (req: Request, res: Response) => {
        const body = (req.body || {}) as Record<string, unknown>;
        if (!ensureUserRequested(body)) {
            sendErr(res, 403, 'connector_not_user_requested', 'userRequested must be true');
            return;
        }
        try {
            const link = pickInstanceLink(body["instanceLink"]);
            const reminder = remindersStore.createLocal(pickReminderInput(body, link));
            const audit = recordAudit(auditLog, 'reminders', 'create', reminder.id, link);
            res.status(201).json({ ok: true, reminder, audit });
        } catch (e) {
            sendErr(res, 400, 'connector_invalid_input', e);
        }
    });

    router.patch('/reminders/:id', (req: Request, res: Response) => {
        const body = (req.body || {}) as Record<string, unknown>;
        if (!ensureUserRequested(body)) {
            sendErr(res, 403, 'connector_not_user_requested', 'userRequested must be true');
            return;
        }
        try {
            const id = String(req.params["id"] || '');
            const link = pickInstanceLink(body["instanceLink"]);
            const reminder = remindersStore.updateLocal(id, pickReminderPatch(body));
            if (!reminder) {
                sendErr(res, 404, 'connector_target_not_found', 'reminder not found');
                return;
            }
            const audit = recordAudit(auditLog, 'reminders', 'update', reminder.id, link);
            res.json({ ok: true, reminder, audit });
        } catch (e) {
            sendErr(res, 400, 'connector_invalid_input', e);
        }
    });

    router.post('/notes', async (req: Request, res: Response) => {
        const body = (req.body || {}) as Record<string, unknown>;
        if (!ensureUserRequested(body)) {
            sendErr(res, 403, 'connector_not_user_requested', 'userRequested must be true');
            return;
        }
        try {
            const path = typeof body["path"] === 'string' ? body["path"] : '';
            const content = typeof body["body"] === 'string'
                ? body["body"]
                : typeof body["content"] === 'string' ? body["content"] : '';
            if (!path) {
                sendErr(res, 400, 'connector_invalid_input', 'path required');
                return;
            }
            const link = pickInstanceLink(body["instanceLink"]);
            await ensureNoteParentFolder(notesStore, path);
            const note = await notesStore.writeFile({ path, content });
            const audit = recordAudit(auditLog, 'notes', 'write', note.path, link);
            res.status(201).json({ ok: true, note, audit });
        } catch (e) {
            const statusCode = (e as { statusCode?: number } | null | undefined)?.statusCode;
            const status = typeof statusCode === 'number' ? statusCode : 500;
            const code = status === 400 || status === 404 || status === 409 || status === 413
                ? 'connector_invalid_input'
                : 'connector_surface_failed';
            sendErr(res, status, code, e);
        }
    });

    router.get('/audit', (req: Request, res: Response) => {
        try {
            const limitParam = req.query["limit"];
            const limit = typeof limitParam === 'string' ? Number(limitParam) : Number(limitParam);
            const events = auditLog.list(Number.isFinite(limit) ? limit : undefined);
            res.json({ ok: true, events });
        } catch (e) {
            sendErr(res, 500, 'connector_audit_failed', e);
        }
    });

    return router;
}

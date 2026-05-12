import { Router, type Response } from 'express';
import { WorkspaceRevisionError, WorkspaceStore } from './store.js';
import type {
    DashboardMatrixBucket,
    DashboardWorkItemInput,
    DashboardWorkItemPatch,
    DashboardWorkPriority,
    DashboardWorkStatus,
    DashboardWorkspaceActor,
    DashboardWorkspaceInstanceLink,
    DashboardWorkspaceMoveInput,
} from './types.js';
import {
    DASHBOARD_MATRIX_BUCKETS,
    DASHBOARD_WORK_PRIORITIES,
    DASHBOARD_WORK_STATUSES,
    DASHBOARD_WORKSPACE_ACTORS,
} from './types.js';

export type DashboardWorkspaceRouterOptions = {
    store?: WorkspaceStore;
};

function sendErr(res: Response, status: number, code: string, error: unknown): void {
    res.status(status).json({
        ok: false,
        code,
        error: error instanceof Error ? error.message : String(error),
    });
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalRevision(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const revision = Number(value);
    if (!Number.isInteger(revision) || revision < 1) throw new Error('revision must be a positive integer');
    return revision;
}

function optionalLimit(value: unknown): number {
    if (value === undefined || value === null || value === '') return 50;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
    return Math.min(200, limit);
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
    throw new Error(`invalid ${field}`);
}

function actor(value: unknown): DashboardWorkspaceActor | undefined {
    return optionalEnum(value, DASHBOARD_WORKSPACE_ACTORS, 'actor');
}

function status(value: unknown): DashboardWorkStatus | undefined {
    return optionalEnum(value, DASHBOARD_WORK_STATUSES, 'status');
}

function priority(value: unknown): DashboardWorkPriority | undefined {
    return optionalEnum(value, DASHBOARD_WORK_PRIORITIES, 'priority');
}

function matrixBucket(value: unknown): DashboardMatrixBucket | undefined {
    return optionalEnum(value, DASHBOARD_MATRIX_BUCKETS, 'matrixBucket');
}

function pickCreate(body: Record<string, unknown>): DashboardWorkItemInput {
    const input: DashboardWorkItemInput = {
        title: typeof body["title"] === 'string' ? body["title"] : '',
        actor: actor(body["actor"]) ?? 'human',
    };
    if ('body' in body) input.body = typeof body["body"] === 'string' ? body["body"] : null;
    if ('status' in body) {
        const nextStatus = status(body["status"]);
        if (nextStatus !== undefined) input.status = nextStatus;
    }
    if ('priority' in body) {
        const nextPriority = priority(body["priority"]);
        if (nextPriority !== undefined) input.priority = nextPriority;
    }
    if ('matrixBucket' in body) {
        const nextBucket = matrixBucket(body["matrixBucket"]);
        if (nextBucket !== undefined) input.matrixBucket = nextBucket;
    }
    if ('boardLane' in body) input.boardLane = typeof body["boardLane"] === 'string' ? body["boardLane"] : null;
    if ('dueAt' in body) input.dueAt = typeof body["dueAt"] === 'string' ? body["dueAt"] : null;
    if ('remindAt' in body) input.remindAt = typeof body["remindAt"] === 'string' ? body["remindAt"] : null;
    if (Array.isArray(body["notePaths"])) input.notePaths = body["notePaths"] as string[];
    if (Array.isArray(body["instanceLinks"])) input.instanceLinks = body["instanceLinks"] as DashboardWorkspaceInstanceLink[];
    return input;
}

function pickPatch(body: Record<string, unknown>): DashboardWorkItemPatch {
    const patch: DashboardWorkItemPatch = {};
    if ('title' in body) patch.title = typeof body["title"] === 'string' ? body["title"] : '';
    if ('body' in body) patch.body = typeof body["body"] === 'string' ? body["body"] : null;
    if ('status' in body) {
        const nextStatus = status(body["status"]);
        if (nextStatus !== undefined) patch.status = nextStatus;
    }
    if ('priority' in body) {
        const nextPriority = priority(body["priority"]);
        if (nextPriority !== undefined) patch.priority = nextPriority;
    }
    if ('matrixBucket' in body) {
        const nextBucket = matrixBucket(body["matrixBucket"]);
        if (nextBucket !== undefined) patch.matrixBucket = nextBucket;
    }
    if ('boardLane' in body) patch.boardLane = typeof body["boardLane"] === 'string' ? body["boardLane"] : null;
    if ('dueAt' in body) patch.dueAt = typeof body["dueAt"] === 'string' ? body["dueAt"] : null;
    if ('remindAt' in body) patch.remindAt = typeof body["remindAt"] === 'string' ? body["remindAt"] : null;
    if ('notePaths' in body) patch.notePaths = Array.isArray(body["notePaths"]) ? body["notePaths"] as string[] : [];
    if ('instanceLinks' in body) patch.instanceLinks = Array.isArray(body["instanceLinks"]) ? body["instanceLinks"] as DashboardWorkspaceInstanceLink[] : [];
    const revision = optionalRevision(body["revision"]);
    if (revision !== undefined) patch.revision = revision;
    patch.actor = actor(body["actor"]) ?? 'agent';
    return patch;
}

function pickMove(body: Record<string, unknown>): DashboardWorkspaceMoveInput {
    const input: DashboardWorkspaceMoveInput = { actor: actor(body["actor"]) ?? 'agent' };
    if ('boardLane' in body) input.boardLane = typeof body["boardLane"] === 'string' ? body["boardLane"] : null;
    if ('matrixBucket' in body) {
        const nextBucket = matrixBucket(body["matrixBucket"]);
        if (nextBucket !== undefined) input.matrixBucket = nextBucket;
    }
    if ('status' in body) {
        const nextStatus = status(body["status"]);
        if (nextStatus !== undefined) input.status = nextStatus;
    }
    const revision = optionalRevision(body["revision"]);
    if (revision !== undefined) input.revision = revision;
    return input;
}

function handleWorkspaceError(res: Response, fallbackCode: string, error: unknown): void {
    if (error instanceof WorkspaceRevisionError) {
        sendErr(res, 409, 'workspace_revision_conflict', error);
        return;
    }
    sendErr(res, 400, fallbackCode, error);
}

export function createDashboardWorkspaceRouter(options: DashboardWorkspaceRouterOptions = {}): Router {
    const router = Router();
    const store = options.store ?? new WorkspaceStore();

    router.get('/snapshot', (_req, res) => {
        try {
            res.json({ ok: true, ...store.snapshot() });
        } catch (error) {
            sendErr(res, 500, 'workspace_snapshot_failed', error);
        }
    });

    router.get('/items', (_req, res) => {
        try {
            res.json({ ok: true, items: store.listItems() });
        } catch (error) {
            sendErr(res, 500, 'workspace_items_failed', error);
        }
    });

    router.post('/items', (req, res) => {
        try {
            const item = store.createItem(pickCreate(asRecord(req.body)));
            res.status(201).json({ ok: true, item });
        } catch (error) {
            handleWorkspaceError(res, 'workspace_item_create_failed', error);
        }
    });

    router.patch('/items/:id', (req, res) => {
        try {
            const item = store.updateItem(String(req.params["id"] || ''), pickPatch(asRecord(req.body)));
            if (!item) { sendErr(res, 404, 'workspace_item_not_found', 'not found'); return; }
            res.json({ ok: true, item });
        } catch (error) {
            handleWorkspaceError(res, 'workspace_item_update_failed', error);
        }
    });

    router.post('/items/:id/move', (req, res) => {
        try {
            const item = store.moveItem(String(req.params["id"] || ''), pickMove(asRecord(req.body)));
            if (!item) { sendErr(res, 404, 'workspace_item_not_found', 'not found'); return; }
            res.json({ ok: true, item });
        } catch (error) {
            handleWorkspaceError(res, 'workspace_item_move_failed', error);
        }
    });

    router.post('/items/:id/link-note', (req, res) => {
        try {
            const body = asRecord(req.body);
            const path = typeof body["path"] === 'string' ? body["path"] : '';
            const item = store.linkNote(String(req.params["id"] || ''), path, optionalRevision(body["revision"]), actor(body["actor"]) ?? 'agent');
            if (!item) { sendErr(res, 404, 'workspace_item_not_found', 'not found'); return; }
            res.json({ ok: true, item });
        } catch (error) {
            handleWorkspaceError(res, 'workspace_link_note_failed', error);
        }
    });

    router.post('/items/:id/link-instance', (req, res) => {
        try {
            const body = asRecord(req.body);
            const link = asRecord(body["link"]) as DashboardWorkspaceInstanceLink;
            const item = store.linkInstance(String(req.params["id"] || ''), link, optionalRevision(body["revision"]), actor(body["actor"]) ?? 'agent');
            if (!item) { sendErr(res, 404, 'workspace_item_not_found', 'not found'); return; }
            res.json({ ok: true, item });
        } catch (error) {
            handleWorkspaceError(res, 'workspace_link_instance_failed', error);
        }
    });

    router.get('/events', (req, res) => {
        try {
            res.json({ ok: true, events: store.listEvents(optionalLimit(req.query["limit"])) });
        } catch (error) {
            sendErr(res, 400, 'workspace_events_failed', error);
        }
    });

    return router;
}

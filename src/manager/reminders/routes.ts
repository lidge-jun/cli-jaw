import { Router, type Request, type Response } from 'express';
import type { ReminderPriority, ReminderStatus } from '../../reminders/types.js';
import { createLocalReminder, listDashboardReminders, refreshDashboardReminders, updateLocalReminder, type DashboardRemindersApiOptions } from './api.js';
import { RemindersStore, type DashboardReminderInput, type DashboardReminderPatch } from './store.js';

export type DashboardRemindersRouterOptions = {
    store?: RemindersStore;
    sourcePath?: string;
};

function sendErr(res: Response, status: number, code: string, error: unknown): void {
    res.status(status).json({
        ok: false,
        code,
        error: error instanceof Error ? error.message : String(error),
    });
}

function wantsRefresh(req: Request): boolean {
    return req.query["refresh"] === '1' || req.query["refresh"] === 'true';
}

function apiOptions(store: RemindersStore, sourcePath: string | undefined): DashboardRemindersApiOptions {
    return sourcePath ? { store, sourcePath } : { store };
}

function pickPriority(value: unknown): ReminderPriority {
    return value === 'low' || value === 'normal' || value === 'high' ? value : 'normal';
}

function pickStatus(value: unknown): ReminderStatus | null {
    return value === 'open' || value === 'focused' || value === 'waiting' || value === 'done' ? value : null;
}

function pickPatchPriority(value: unknown): ReminderPriority | null {
    return value === 'low' || value === 'normal' || value === 'high' ? value : null;
}

function pickFromMessageInput(body: Record<string, unknown>): DashboardReminderInput {
    const port = typeof body["port"] === 'number' ? body["port"] : Number(body["port"]);
    const turnIndex = body["turnIndex"] === null || body["turnIndex"] === undefined
        ? null
        : typeof body["turnIndex"] === 'number' ? body["turnIndex"] : Number(body["turnIndex"]);
    const sourceText = typeof body["sourceText"] === 'string' ? body["sourceText"] : typeof body["notes"] === 'string' ? body["notes"] : null;
    return {
        title: typeof body["title"] === 'string' ? body["title"] : '',
        notes: typeof body["notes"] === 'string' ? body["notes"] : sourceText,
        priority: pickPriority(body["priority"]),
        dueAt: typeof body["dueAt"] === 'string' ? body["dueAt"] : null,
        remindAt: typeof body["remindAt"] === 'string' ? body["remindAt"] : null,
        linkedInstance: Number.isFinite(port) && port > 0 ? String(port) : null,
        sourceText,
        link: {
            instanceId: typeof body["instanceId"] === 'string' ? body["instanceId"] : Number.isFinite(port) ? `port:${port}` : '',
            messageId: typeof body["messageId"] === 'string' ? body["messageId"] : '',
            turnIndex,
            port: Number.isFinite(port) ? port : null,
            threadKey: typeof body["threadKey"] === 'string' ? body["threadKey"] : null,
            sourceText,
        },
    };
}

function pickPatch(body: Record<string, unknown>): DashboardReminderPatch {
    const patch: DashboardReminderPatch = {};
    if (typeof body["title"] === 'string') patch.title = body["title"];
    if ('notes' in body) patch.notes = typeof body["notes"] === 'string' ? body["notes"] : null;
    const status = pickStatus(body["status"]);
    if (status) patch.status = status;
    const priority = pickPatchPriority(body["priority"]);
    if (priority) patch.priority = priority;
    if ('dueAt' in body) patch.dueAt = typeof body["dueAt"] === 'string' ? body["dueAt"] : null;
    if ('remindAt' in body) patch.remindAt = typeof body["remindAt"] === 'string' ? body["remindAt"] : null;
    if ('linkedInstance' in body) patch.linkedInstance = typeof body["linkedInstance"] === 'string' ? body["linkedInstance"] : null;
    return patch;
}

export function createDashboardRemindersRouter(options: DashboardRemindersRouterOptions = {}): Router {
    const router = Router();
    const store = options.store || new RemindersStore();

    router.get('/', async (req: Request, res: Response) => {
        try {
            const feed = wantsRefresh(req)
                ? await refreshDashboardReminders(apiOptions(store, options.sourcePath))
                : listDashboardReminders({ store });
            res.json({ ok: true, ...feed });
        } catch (error) {
            sendErr(res, 500, 'reminders_list_failed', error);
        }
    });

    router.post('/refresh', async (_req: Request, res: Response) => {
        try {
            const feed = await refreshDashboardReminders(apiOptions(store, options.sourcePath));
            res.json({ ok: true, ...feed });
        } catch (error) {
            sendErr(res, 500, 'reminders_refresh_failed', error);
        }
    });

    router.post('/from-message', (req: Request, res: Response) => {
        try {
            const item = createLocalReminder(pickFromMessageInput((req.body || {}) as Record<string, unknown>), { store });
            res.status(201).json({ ok: true, item });
        } catch (error) {
            sendErr(res, 400, 'reminder_from_message_failed', error);
        }
    });

    router.patch('/:id', (req: Request, res: Response) => {
        try {
            const id = String(req.params["id"] || '');
            const item = updateLocalReminder(id, pickPatch((req.body || {}) as Record<string, unknown>), { store });
            if (!item) { sendErr(res, 404, 'reminder_not_found', 'not found'); return; }
            res.json({ ok: true, item });
        } catch (error) {
            sendErr(res, 400, 'reminder_update_failed', error);
        }
    });

    return router;
}

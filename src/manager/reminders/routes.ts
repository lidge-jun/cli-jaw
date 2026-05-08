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

function optionalInteger(value: unknown, field: string): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed)) throw new Error(`${field} must be an integer`);
    return parsed;
}

function pickPriority(value: unknown, required = false): ReminderPriority | undefined {
    if (value === undefined || value === null || value === '') {
        if (required) throw new Error('priority required');
        return undefined;
    }
    if (value === 'low' || value === 'normal' || value === 'high') return value;
    throw new Error('invalid priority');
}

function pickStatus(value: unknown): ReminderStatus | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === 'open' || value === 'focused' || value === 'waiting' || value === 'done') return value;
    throw new Error('invalid status');
}

function requiredStatus(value: unknown): ReminderStatus {
    const status = pickStatus(value);
    if (!status) throw new Error('invalid status');
    return status;
}

function requiredPriority(value: unknown): ReminderPriority {
    const priority = pickPriority(value, true);
    if (!priority) throw new Error('invalid priority');
    return priority;
}

function pickFromMessageInput(body: Record<string, unknown>): DashboardReminderInput {
    const port = optionalInteger(body["port"], 'port');
    if (port !== null && port < 1) throw new Error('port must be positive');
    const turnIndex = optionalInteger(body["turnIndex"], 'turnIndex');
    if (turnIndex !== null && turnIndex < 0) throw new Error('turnIndex must be non-negative');
    const sourceText = typeof body["sourceText"] === 'string' ? body["sourceText"] : typeof body["notes"] === 'string' ? body["notes"] : null;
    return {
        title: typeof body["title"] === 'string' ? body["title"] : '',
        notes: typeof body["notes"] === 'string' ? body["notes"] : sourceText,
        priority: pickPriority(body["priority"]) ?? 'normal',
        dueAt: typeof body["dueAt"] === 'string' ? body["dueAt"] : null,
        remindAt: typeof body["remindAt"] === 'string' ? body["remindAt"] : null,
        linkedInstance: port ? String(port) : null,
        sourceText,
        link: {
            instanceId: typeof body["instanceId"] === 'string' ? body["instanceId"] : port ? `port:${port}` : '',
            messageId: typeof body["messageId"] === 'string' ? body["messageId"] : '',
            turnIndex,
            port,
            threadKey: typeof body["threadKey"] === 'string' ? body["threadKey"] : null,
            sourceText,
        },
    };
}

function pickPatch(body: Record<string, unknown>): DashboardReminderPatch {
    const patch: DashboardReminderPatch = {};
    if (typeof body["title"] === 'string') patch.title = body["title"];
    if ('notes' in body) patch.notes = typeof body["notes"] === 'string' ? body["notes"] : null;
    if ('status' in body) patch.status = requiredStatus(body["status"]);
    if ('priority' in body) patch.priority = requiredPriority(body["priority"]);
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

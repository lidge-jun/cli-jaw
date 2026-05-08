import { RemindersStore, type DashboardReminder, type DashboardReminderInput } from '../manager/reminders/store.js';

export type RemindersCliResult =
    | { ok: true; action: 'list'; items: DashboardReminder[] }
    | { ok: true; action: 'add'; item: DashboardReminder }
    | { ok: true; action: 'done'; item: DashboardReminder }
    | { ok: false; code: string; error: string };

export function listRemindersForCli(store = new RemindersStore()): RemindersCliResult {
    return { ok: true, action: 'list', items: store.list() };
}

export function addReminderForCli(input: DashboardReminderInput, store = new RemindersStore()): RemindersCliResult {
    try {
        return { ok: true, action: 'add', item: store.createLocal(input) };
    } catch (error) {
        return { ok: false, code: 'reminder_add_failed', error: (error as Error).message };
    }
}

export function markReminderDoneForCli(id: string, store = new RemindersStore()): RemindersCliResult {
    try {
        const item = store.updateLocal(id, { status: 'done' });
        if (!item) return { ok: false, code: 'reminder_not_found', error: `Reminder not found: ${id}` };
        return { ok: true, action: 'done', item };
    } catch (error) {
        return { ok: false, code: 'reminder_done_failed', error: (error as Error).message };
    }
}

export function formatReminder(item: DashboardReminder): string {
    const when = item.remindAt || item.dueAt || item.sourceUpdatedAt;
    const link = item.port ? ` :${item.port}` : '';
    return `${item.id} [${item.status}/${item.priority}] ${item.title}${link} — ${when}`;
}

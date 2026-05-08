import type { DashboardReminder } from './store.js';

export type ReminderDueDecision =
    | { status: 'due'; reminder: DashboardReminder }
    | { status: 'future'; reminder: DashboardReminder }
    | { status: 'invalid_remind_at'; reminder: DashboardReminder; error: string }
    | { status: 'skipped'; reminder: DashboardReminder; reason: 'done' | 'already_attempted' | 'missing_remind_at' };

export function classifyReminderDue(reminder: DashboardReminder, now = new Date()): ReminderDueDecision {
    if (reminder.status === 'done') return { status: 'skipped', reminder, reason: 'done' };
    if (reminder.notificationStatus !== 'pending') return { status: 'skipped', reminder, reason: 'already_attempted' };
    if (!reminder.remindAt) return { status: 'skipped', reminder, reason: 'missing_remind_at' };
    const due = Date.parse(reminder.remindAt);
    if (Number.isNaN(due)) {
        return { status: 'invalid_remind_at', reminder, error: `invalid remindAt: ${reminder.remindAt}` };
    }
    return due <= now.getTime()
        ? { status: 'due', reminder }
        : { status: 'future', reminder };
}

import type { DashboardReminder, DashboardReminderCreateInput, DashboardReminderPatchInput } from './reminders-api';
import type { RemindersView } from './DashboardRemindersSidebar';

export type MatrixBucket = 'urgentImportant' | 'important' | 'waiting' | 'later';

export type MatrixSection = {
    id: MatrixBucket;
    title: string;
    tone: 'red' | 'green' | 'amber' | 'blue';
};

export const MATRIX_SECTIONS: readonly MatrixSection[] = [
    { id: 'urgentImportant', title: 'Important and Urgent', tone: 'red' },
    { id: 'important', title: 'Important, Not Urgent', tone: 'green' },
    { id: 'waiting', title: 'Waiting / Delegated', tone: 'amber' },
    { id: 'later', title: 'Later', tone: 'blue' },
] as const;

export const MATRIX_DEFAULTS: Record<MatrixBucket, Pick<DashboardReminderCreateInput, 'listId' | 'status' | 'priority'>> = {
    urgentImportant: { listId: 'today', status: 'open', priority: 'high' },
    important: { listId: 'today', status: 'open', priority: 'normal' },
    waiting: { listId: 'waiting', status: 'waiting', priority: 'normal' },
    later: { listId: 'later', status: 'open', priority: 'low' },
};

export function matrixBucketToPatch(bucket: MatrixBucket): DashboardReminderPatchInput {
    return MATRIX_DEFAULTS[bucket];
}

export function resolveReminderMatrixBucket(item: DashboardReminder): MatrixBucket | null {
    if (item.status === 'done') return null;
    if (item.status === 'focused') return 'urgentImportant';
    if (item.status === 'waiting') return 'waiting';
    if (item.listId === 'later' || item.priority === 'low') return 'later';
    if (item.priority === 'high') return 'urgentImportant';
    return 'important';
}

export function matrixItems(bucket: MatrixBucket, items: DashboardReminder[]): DashboardReminder[] {
    return items.filter(item => resolveReminderMatrixBucket(item) === bucket);
}

export function remindersForView(view: RemindersView, items: DashboardReminder[]): DashboardReminder[] {
    if (view === 'matrix') return items.filter(item => item.status !== 'done');
    if (view === 'done') return items.filter(item => item.status === 'done');
    if (view === 'focused') return matrixItems('urgentImportant', items);
    if (view === 'important') return matrixItems('important', items);
    if (view === 'waiting') return matrixItems('waiting', items);
    if (view === 'later') return matrixItems('later', items);
    return items.filter(item => item.status !== 'done');
}

export function countRemindersView(view: RemindersView, items: DashboardReminder[]): number {
    return remindersForView(view, items).length;
}

export function rankTopPriorityItems(items: DashboardReminder[], limit = 3): DashboardReminder[] {
    const focused = items.find(item => item.status === 'focused') ?? null;
    const focusedId = focused?.id ?? null;
    const ranked = items
        .filter(item => item.status !== 'done' && item.id !== focusedId)
        .sort(compareNextAction);
    return (focused ? [focused, ...ranked] : ranked).slice(0, limit);
}

function compareNextAction(left: DashboardReminder, right: DashboardReminder): number {
    return (
        nextTimeScore(left) - nextTimeScore(right) ||
        priorityScore(left) - priorityScore(right) ||
        Date.parse(left.sourceCreatedAt) - Date.parse(right.sourceCreatedAt)
    );
}

function nextTimeScore(item: DashboardReminder): number {
    const candidates = [item.remindAt, item.dueAt]
        .filter((value): value is string => Boolean(value))
        .map(value => Date.parse(value))
        .filter((value): value is number => Number.isFinite(value));
    return candidates.length > 0 ? Math.min(...candidates) : Number.MAX_SAFE_INTEGER;
}

function priorityScore(item: DashboardReminder): number {
    if (item.priority === 'high') return 0;
    if (item.priority === 'normal') return 1;
    return 2;
}

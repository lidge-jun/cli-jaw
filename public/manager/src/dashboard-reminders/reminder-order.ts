import type { DashboardReminder } from './reminders-api';

export const DEFAULT_RANK_STEP = 1000;

export function compareManualPriority(left: DashboardReminder, right: DashboardReminder): number {
    return (
        focusedScore(left) - focusedScore(right)
        || priorityScore(left) - priorityScore(right)
        || manualRankScore(left) - manualRankScore(right)
        || nextTimeScore(left) - nextTimeScore(right)
        || Date.parse(left.sourceCreatedAt) - Date.parse(right.sourceCreatedAt)
    );
}

export function nextRankBetween(previous: DashboardReminder | null, next: DashboardReminder | null): number {
    const previousRank = previous?.manualRank ?? null;
    const nextRank = next?.manualRank ?? null;
    if (previousRank === null && nextRank === null) return DEFAULT_RANK_STEP;
    if (previousRank === null && nextRank !== null) return nextRank - DEFAULT_RANK_STEP;
    if (previousRank !== null && nextRank === null) return previousRank + DEFAULT_RANK_STEP;
    if (previousRank !== null && nextRank !== null) return (previousRank + nextRank) / 2;
    return DEFAULT_RANK_STEP;
}

function focusedScore(item: DashboardReminder): number {
    return item.status === 'focused' ? 0 : 1;
}

function manualRankScore(item: DashboardReminder): number {
    return item.manualRank ?? Number.MAX_SAFE_INTEGER;
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

import type {
    DashboardWorkspaceItem,
    WorkspaceBoardLane,
    WorkspaceInstanceLink,
    WorkspaceMatrixBucket,
} from './workspace-types';
import {
    WORKSPACE_BOARD_LANES,
    WORKSPACE_MATRIX_BUCKETS,
} from './workspace-types';

export type WorkspaceBoardProjection = Record<WorkspaceBoardLane, DashboardWorkspaceItem[]>;
export type WorkspaceMatrixProjection = Record<WorkspaceMatrixBucket, DashboardWorkspaceItem[]>;

const PRIORITY_WEIGHT: Record<DashboardWorkspaceItem['priority'], number> = {
    high: 0,
    normal: 1,
    low: 2,
};

function timestamp(value: string | null): number {
    if (!value) return Number.POSITIVE_INFINITY;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function itemActivityTime(item: DashboardWorkspaceItem): number {
    const due = timestamp(item.dueAt);
    const remind = timestamp(item.remindAt);
    const scheduled = Math.min(due, remind);
    return Number.isFinite(scheduled) ? scheduled : timestamp(item.createdAt);
}

function byPriorityThenTime(a: DashboardWorkspaceItem, b: DashboardWorkspaceItem): number {
    const priority = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
    if (priority !== 0) return priority;
    const time = itemActivityTime(a) - itemActivityTime(b);
    if (time !== 0) return time;
    return a.title.localeCompare(b.title);
}

function laneFromStatus(item: DashboardWorkspaceItem): WorkspaceBoardLane {
    if (item.status === 'done') return 'done';
    if (item.status === 'review') return 'review';
    if (item.status === 'active' || item.status === 'blocked') return 'active';
    return 'backlog';
}

export function workspaceBoardLane(item: DashboardWorkspaceItem): WorkspaceBoardLane {
    const lane = WORKSPACE_BOARD_LANES.find(candidate => candidate === item.boardLane);
    return lane ?? laneFromStatus(item);
}

export function itemsToBoardLanes(items: DashboardWorkspaceItem[]): WorkspaceBoardProjection {
    const lanes: WorkspaceBoardProjection = {
        backlog: [],
        ready: [],
        active: [],
        review: [],
        done: [],
    };
    for (const item of items) lanes[workspaceBoardLane(item)].push(item);
    for (const lane of WORKSPACE_BOARD_LANES) lanes[lane].sort(byPriorityThenTime);
    return lanes;
}

export function itemsToMatrixBuckets(items: DashboardWorkspaceItem[]): WorkspaceMatrixProjection {
    const buckets: WorkspaceMatrixProjection = {
        urgentImportant: [],
        important: [],
        waiting: [],
        later: [],
    };
    for (const item of items) {
        if (item.status === 'done') continue;
        buckets[item.matrixBucket].push(item);
    }
    for (const bucket of WORKSPACE_MATRIX_BUCKETS) buckets[bucket].sort(byPriorityThenTime);
    return buckets;
}

export function itemsToTopPriority(items: DashboardWorkspaceItem[], limit = 3): DashboardWorkspaceItem[] {
    return items
        .filter(item => item.status !== 'done')
        .slice()
        .sort(byPriorityThenTime)
        .slice(0, Math.max(0, limit));
}

export function itemsForNote(path: string, items: DashboardWorkspaceItem[]): DashboardWorkspaceItem[] {
    const normalized = path.trim().replaceAll('\\', '/');
    if (!normalized) return [];
    return items
        .filter(item => item.notePaths.some(notePath => notePath === normalized))
        .sort(byPriorityThenTime);
}

function linkMatches(link: WorkspaceInstanceLink, query: WorkspaceInstanceLink): boolean {
    if (query.instanceId && link.instanceId === query.instanceId) return true;
    if (query.messageId && link.messageId === query.messageId) return true;
    if (query.threadKey && link.threadKey === query.threadKey) return true;
    if (query.port !== null && query.port !== undefined && link.port === query.port) return true;
    return false;
}

export function itemsForInstance(query: WorkspaceInstanceLink, items: DashboardWorkspaceItem[]): DashboardWorkspaceItem[] {
    return items
        .filter(item => item.instanceLinks.some(link => linkMatches(link, query)))
        .sort(byPriorityThenTime);
}

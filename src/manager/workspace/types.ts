export const DASHBOARD_WORK_STATUSES = ['backlog', 'active', 'blocked', 'review', 'done'] as const;
export const DASHBOARD_WORK_PRIORITIES = ['high', 'normal', 'low'] as const;
export const DASHBOARD_MATRIX_BUCKETS = ['urgentImportant', 'important', 'waiting', 'later'] as const;
export const DASHBOARD_WORKSPACE_ACTORS = ['human', 'agent', 'system'] as const;

export type DashboardWorkStatus = typeof DASHBOARD_WORK_STATUSES[number];
export type DashboardWorkPriority = typeof DASHBOARD_WORK_PRIORITIES[number];
export type DashboardMatrixBucket = typeof DASHBOARD_MATRIX_BUCKETS[number];
export type DashboardWorkspaceActor = typeof DASHBOARD_WORKSPACE_ACTORS[number];

export type DashboardWorkspaceInstanceLink = {
    instanceId: string | null;
    port: number | null;
    messageId: string | null;
    turnIndex: number | null;
    threadKey: string | null;
};

export type DashboardWorkItem = {
    id: string;
    title: string;
    body: string;
    status: DashboardWorkStatus;
    priority: DashboardWorkPriority;
    matrixBucket: DashboardMatrixBucket;
    boardLane: string;
    dueAt: string | null;
    remindAt: string | null;
    notePaths: string[];
    instanceLinks: DashboardWorkspaceInstanceLink[];
    createdBy: DashboardWorkspaceActor;
    updatedBy: DashboardWorkspaceActor;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type DashboardWorkspaceEventKind =
    | 'item-created'
    | 'item-updated'
    | 'item-moved'
    | 'note-linked'
    | 'instance-linked';

export type DashboardWorkspaceEvent = {
    id: string;
    itemId: string;
    kind: DashboardWorkspaceEventKind;
    actor: DashboardWorkspaceActor;
    summary: string;
    revision: number;
    createdAt: string;
};

export type DashboardWorkspaceSnapshot = {
    items: DashboardWorkItem[];
    board: Record<string, DashboardWorkItem[]>;
    matrix: Record<DashboardMatrixBucket, DashboardWorkItem[]>;
    events: DashboardWorkspaceEvent[];
};

export type DashboardWorkItemInput = {
    title: string;
    body?: string | null;
    status?: DashboardWorkStatus;
    priority?: DashboardWorkPriority;
    matrixBucket?: DashboardMatrixBucket;
    boardLane?: string | null;
    dueAt?: string | null;
    remindAt?: string | null;
    notePaths?: string[];
    instanceLinks?: DashboardWorkspaceInstanceLink[];
    actor?: DashboardWorkspaceActor;
};

export type DashboardWorkItemPatch = Partial<Omit<DashboardWorkItemInput, 'actor'>> & {
    revision?: number;
    actor?: DashboardWorkspaceActor;
};

export type DashboardWorkspaceMoveInput = {
    boardLane?: string | null;
    matrixBucket?: DashboardMatrixBucket;
    status?: DashboardWorkStatus;
    revision?: number;
    actor?: DashboardWorkspaceActor;
};

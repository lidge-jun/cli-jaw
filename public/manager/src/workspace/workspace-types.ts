export const WORKSPACE_BOARD_LANES = ['backlog', 'ready', 'active', 'review', 'done'] as const;
export const WORKSPACE_MATRIX_BUCKETS = ['urgentImportant', 'important', 'waiting', 'later'] as const;
export const WORKSPACE_WORK_STATUSES = ['backlog', 'active', 'blocked', 'review', 'done'] as const;
export const WORKSPACE_WORK_PRIORITIES = ['high', 'normal', 'low'] as const;

export type WorkspaceBoardLane = typeof WORKSPACE_BOARD_LANES[number];
export type WorkspaceMatrixBucket = typeof WORKSPACE_MATRIX_BUCKETS[number];
export type WorkspaceWorkStatus = typeof WORKSPACE_WORK_STATUSES[number];
export type WorkspaceWorkPriority = typeof WORKSPACE_WORK_PRIORITIES[number];
export type WorkspaceActor = 'human' | 'agent' | 'system';

export type WorkspaceInstanceLink = {
    instanceId: string | null;
    port: number | null;
    messageId: string | null;
    turnIndex: number | null;
    threadKey: string | null;
};

export type DashboardWorkspaceItem = {
    id: string;
    title: string;
    body: string;
    status: WorkspaceWorkStatus;
    priority: WorkspaceWorkPriority;
    matrixBucket: WorkspaceMatrixBucket;
    boardLane: string;
    dueAt: string | null;
    remindAt: string | null;
    notePaths: string[];
    instanceLinks: WorkspaceInstanceLink[];
    createdBy: WorkspaceActor;
    updatedBy: WorkspaceActor;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type DashboardWorkspaceEvent = {
    id: string;
    itemId: string;
    kind: 'item-created' | 'item-updated' | 'item-moved' | 'note-linked' | 'instance-linked';
    actor: WorkspaceActor;
    summary: string;
    revision: number;
    createdAt: string;
};

export type DashboardWorkspaceSnapshot = {
    items: DashboardWorkspaceItem[];
    board: Record<string, DashboardWorkspaceItem[]>;
    matrix: Record<WorkspaceMatrixBucket, DashboardWorkspaceItem[]>;
    events: DashboardWorkspaceEvent[];
};

export type DashboardWorkspaceItemInput = {
    title: string;
    body?: string | null;
    status?: WorkspaceWorkStatus;
    priority?: WorkspaceWorkPriority;
    matrixBucket?: WorkspaceMatrixBucket;
    boardLane?: string | null;
    dueAt?: string | null;
    remindAt?: string | null;
    notePaths?: string[];
    instanceLinks?: WorkspaceInstanceLink[];
    actor?: WorkspaceActor;
};

export type DashboardWorkspaceItemPatch = Partial<Omit<DashboardWorkspaceItemInput, 'actor'>> & {
    revision?: number;
    actor?: WorkspaceActor;
};

export type DashboardWorkspaceMoveInput = {
    boardLane?: string | null;
    matrixBucket?: WorkspaceMatrixBucket;
    status?: WorkspaceWorkStatus;
    revision?: number;
    actor?: WorkspaceActor;
};

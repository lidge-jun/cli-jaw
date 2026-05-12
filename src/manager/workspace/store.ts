import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { dashboardPath } from '../dashboard-home.js';
import type {
    DashboardMatrixBucket,
    DashboardWorkItem,
    DashboardWorkItemInput,
    DashboardWorkItemPatch,
    DashboardWorkPriority,
    DashboardWorkspaceActor,
    DashboardWorkspaceEvent,
    DashboardWorkspaceEventKind,
    DashboardWorkspaceInstanceLink,
    DashboardWorkspaceMoveInput,
    DashboardWorkspaceSnapshot,
    DashboardWorkStatus,
} from './types.js';
import {
    DASHBOARD_MATRIX_BUCKETS,
    DASHBOARD_WORK_PRIORITIES,
    DASHBOARD_WORK_STATUSES,
    DASHBOARD_WORKSPACE_ACTORS,
} from './types.js';

type WorkspaceRow = {
    id: string;
    title: string;
    body: string;
    status: string;
    priority: string;
    matrix_bucket: string;
    board_lane: string;
    due_at: string | null;
    remind_at: string | null;
    note_paths_json: string;
    instance_links_json: string;
    created_by: string;
    updated_by: string;
    revision: number;
    created_at: string;
    updated_at: string;
};

type EventRow = {
    id: string;
    item_id: string;
    kind: string;
    actor: string;
    summary: string;
    revision: number;
    created_at: string;
};

const MAX_TEXT = 20_000;
const MAX_TITLE = 240;
const MAX_LANE = 80;

export class WorkspaceRevisionError extends Error {
    constructor(message = 'stale revision') {
        super(message);
        this.name = 'WorkspaceRevisionError';
    }
}

export type WorkspaceStoreOptions = {
    dbPath?: string;
};

function ensureDir(p: string): void {
    const d = dirname(p);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function nowIso(): string {
    return new Date().toISOString();
}

function requireText(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== 'string') throw new Error(`${field} required`);
    const text = value.trim();
    if (!text) throw new Error(`${field} required`);
    if (text.length > maxLength) throw new Error(`${field} too long`);
    return text;
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') throw new Error(`${field} must be a string`);
    const text = value.trim();
    if (!text) return null;
    if (text.length > maxLength) throw new Error(`${field} too long`);
    return text;
}

function pickEnum<T extends string>(value: unknown, fallback: T, allowed: readonly T[], field: string): T {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
    throw new Error(`invalid ${field}`);
}

function pickStatus(value: unknown, fallback: DashboardWorkStatus): DashboardWorkStatus {
    return pickEnum(value, fallback, DASHBOARD_WORK_STATUSES, 'status');
}

function pickPriority(value: unknown, fallback: DashboardWorkPriority): DashboardWorkPriority {
    return pickEnum(value, fallback, DASHBOARD_WORK_PRIORITIES, 'priority');
}

function pickBucket(value: unknown, fallback: DashboardMatrixBucket): DashboardMatrixBucket {
    return pickEnum(value, fallback, DASHBOARD_MATRIX_BUCKETS, 'matrixBucket');
}

function pickActor(value: unknown, fallback: DashboardWorkspaceActor): DashboardWorkspaceActor {
    return pickEnum(value, fallback, DASHBOARD_WORKSPACE_ACTORS, 'actor');
}

function safeNotePath(value: string): string {
    const path = value.trim().replaceAll('\\', '/');
    if (!path || path.startsWith('/') || path.includes('\0')) throw new Error('unsafe note path');
    if (path.split('/').some(part => part === '..')) throw new Error('unsafe note path');
    if (path.length > 400) throw new Error('note path too long');
    return path;
}

function normalizeNotePaths(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error('notePaths must be an array');
    return Array.from(new Set(value.map(entry => {
        if (typeof entry !== 'string') throw new Error('note path must be a string');
        return safeNotePath(entry);
    })));
}

function normalizeInstanceLinks(value: unknown): DashboardWorkspaceInstanceLink[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error('instanceLinks must be an array');
    return value.map(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('instance link must be an object');
        const link = entry as Partial<DashboardWorkspaceInstanceLink>;
        return {
            instanceId: typeof link.instanceId === 'string' && link.instanceId.trim() ? link.instanceId.trim() : null,
            port: optionalInteger(link.port, 'port', 1),
            messageId: typeof link.messageId === 'string' && link.messageId.trim() ? link.messageId.trim() : null,
            turnIndex: optionalInteger(link.turnIndex, 'turnIndex', 0),
            threadKey: typeof link.threadKey === 'string' && link.threadKey.trim() ? link.threadKey.trim() : null,
        };
    });
}

function optionalInteger(value: unknown, field: string, min: number): number | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) throw new Error(`${field} must be an integer >= ${min}`);
    return value;
}

function parseJsonArray<T>(raw: string, fallback: T[]): T[] {
    try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? parsed as T[] : fallback;
    } catch {
        return fallback;
    }
}

function rowToItem(row: WorkspaceRow): DashboardWorkItem {
    return {
        id: row.id,
        title: row.title,
        body: row.body,
        status: pickStatus(row.status, 'backlog'),
        priority: pickPriority(row.priority, 'normal'),
        matrixBucket: pickBucket(row.matrix_bucket, 'later'),
        boardLane: row.board_lane,
        dueAt: row.due_at,
        remindAt: row.remind_at,
        notePaths: parseJsonArray<string>(row.note_paths_json, []).map(safeNotePath),
        instanceLinks: parseJsonArray<DashboardWorkspaceInstanceLink>(row.instance_links_json, []),
        createdBy: pickActor(row.created_by, 'system'),
        updatedBy: pickActor(row.updated_by, 'system'),
        revision: row.revision,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToEvent(row: EventRow): DashboardWorkspaceEvent {
    return {
        id: row.id,
        itemId: row.item_id,
        kind: row.kind as DashboardWorkspaceEventKind,
        actor: pickActor(row.actor, 'system'),
        summary: row.summary,
        revision: row.revision,
        createdAt: row.created_at,
    };
}

export class WorkspaceStore {
    private readonly db: Database.Database;

    constructor(options: WorkspaceStoreOptions = {}) {
        const path = options.dbPath || dashboardPath('dashboard.db');
        ensureDir(path);
        this.db = new Database(path);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS dashboard_work_items (
                id                  TEXT PRIMARY KEY,
                title               TEXT NOT NULL,
                body                TEXT NOT NULL DEFAULT '',
                status              TEXT NOT NULL,
                priority            TEXT NOT NULL,
                matrix_bucket       TEXT NOT NULL,
                board_lane          TEXT NOT NULL,
                due_at              TEXT,
                remind_at           TEXT,
                note_paths_json     TEXT NOT NULL DEFAULT '[]',
                instance_links_json TEXT NOT NULL DEFAULT '[]',
                created_by          TEXT NOT NULL,
                updated_by          TEXT NOT NULL,
                revision            INTEGER NOT NULL DEFAULT 1,
                created_at          TEXT NOT NULL,
                updated_at          TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS dashboard_workspace_events (
                id                  TEXT PRIMARY KEY,
                item_id             TEXT NOT NULL,
                kind                TEXT NOT NULL,
                actor               TEXT NOT NULL,
                summary             TEXT NOT NULL,
                revision            INTEGER NOT NULL,
                created_at          TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS dashboard_workspace_note_links (
                item_id             TEXT NOT NULL,
                note_path           TEXT NOT NULL,
                created_at          TEXT NOT NULL,
                PRIMARY KEY (item_id, note_path)
            );
            CREATE INDEX IF NOT EXISTS idx_dashboard_work_items_lane ON dashboard_work_items(board_lane, status);
            CREATE INDEX IF NOT EXISTS idx_dashboard_work_items_matrix ON dashboard_work_items(matrix_bucket, priority);
            CREATE INDEX IF NOT EXISTS idx_dashboard_workspace_events_item ON dashboard_workspace_events(item_id, created_at);
        `);
    }

    close(): void {
        this.db.close();
    }

    listItems(): DashboardWorkItem[] {
        const rows = this.db.prepare(`
            SELECT * FROM dashboard_work_items
            ORDER BY
                CASE status WHEN 'active' THEN 0 WHEN 'blocked' THEN 1 WHEN 'review' THEN 2 WHEN 'backlog' THEN 3 ELSE 4 END,
                updated_at DESC
        `).all() as WorkspaceRow[];
        return rows.map(rowToItem);
    }

    getItem(id: string): DashboardWorkItem | null {
        const row = this.db.prepare('SELECT * FROM dashboard_work_items WHERE id = ?').get(id) as WorkspaceRow | undefined;
        return row ? rowToItem(row) : null;
    }

    createItem(input: DashboardWorkItemInput): DashboardWorkItem {
        const at = nowIso();
        const actor = pickActor(input.actor, 'human');
        const id = randomUUID();
        const title = requireText(input.title, 'title', MAX_TITLE);
        const boardLane = optionalText(input.boardLane, 'boardLane', MAX_LANE) ?? 'backlog';
        const item = {
            id,
            title,
            body: optionalText(input.body, 'body', MAX_TEXT) ?? '',
            status: pickStatus(input.status, 'backlog'),
            priority: pickPriority(input.priority, 'normal'),
            matrixBucket: pickBucket(input.matrixBucket, 'later'),
            boardLane,
            dueAt: optionalText(input.dueAt, 'dueAt', 80),
            remindAt: optionalText(input.remindAt, 'remindAt', 80),
            notePaths: normalizeNotePaths(input.notePaths),
            instanceLinks: normalizeInstanceLinks(input.instanceLinks),
            createdBy: actor,
            updatedBy: actor,
            revision: 1,
            createdAt: at,
            updatedAt: at,
        } satisfies DashboardWorkItem;
        this.db.prepare(`
            INSERT INTO dashboard_work_items (
                id, title, body, status, priority, matrix_bucket, board_lane, due_at, remind_at,
                note_paths_json, instance_links_json, created_by, updated_by, revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            item.id, item.title, item.body, item.status, item.priority, item.matrixBucket, item.boardLane,
            item.dueAt, item.remindAt, JSON.stringify(item.notePaths), JSON.stringify(item.instanceLinks),
            item.createdBy, item.updatedBy, item.revision, item.createdAt, item.updatedAt,
        );
        this.syncNoteLinks(item);
        this.recordEvent(item.id, 'item-created', actor, 'created work item', item.revision, at);
        return item;
    }

    updateItem(id: string, patch: DashboardWorkItemPatch): DashboardWorkItem | null {
        const current = this.getItem(id);
        if (!current) return null;
        if (patch.revision !== undefined && patch.revision !== current.revision) throw new WorkspaceRevisionError();
        const actor = pickActor(patch.actor, 'agent');
        const next = this.mergeItem(current, patch, actor);
        this.writeItem(next);
        this.syncNoteLinks(next);
        this.recordEvent(next.id, 'item-updated', actor, 'updated work item', next.revision, next.updatedAt);
        return next;
    }

    moveItem(id: string, input: DashboardWorkspaceMoveInput): DashboardWorkItem | null {
        const patch: DashboardWorkItemPatch = {};
        if (input.actor !== undefined) patch.actor = input.actor;
        if (input.revision !== undefined) patch.revision = input.revision;
        if (input.boardLane !== undefined) patch.boardLane = input.boardLane;
        if (input.matrixBucket !== undefined) patch.matrixBucket = input.matrixBucket;
        if (input.status !== undefined) patch.status = input.status;
        const item = this.updateItem(id, patch);
        if (item) this.recordEvent(item.id, 'item-moved', pickActor(input.actor, 'agent'), 'moved work item', item.revision, item.updatedAt);
        return item;
    }

    linkNote(id: string, notePath: string, revision?: number, actor: DashboardWorkspaceActor = 'agent'): DashboardWorkItem | null {
        const current = this.getItem(id);
        if (!current) return null;
        const nextPath = safeNotePath(notePath);
        const notePaths = Array.from(new Set([...current.notePaths, nextPath]));
        const patch: DashboardWorkItemPatch = { notePaths, actor };
        if (revision !== undefined) patch.revision = revision;
        const item = this.updateItem(id, patch);
        if (item) this.recordEvent(id, 'note-linked', actor, `linked note ${nextPath}`, item.revision, item.updatedAt);
        return item;
    }

    linkInstance(id: string, link: DashboardWorkspaceInstanceLink, revision?: number, actor: DashboardWorkspaceActor = 'agent'): DashboardWorkItem | null {
        const current = this.getItem(id);
        if (!current) return null;
        const instanceLinks = normalizeInstanceLinks([...current.instanceLinks, link]);
        const patch: DashboardWorkItemPatch = { instanceLinks, actor };
        if (revision !== undefined) patch.revision = revision;
        const item = this.updateItem(id, patch);
        if (item) this.recordEvent(id, 'instance-linked', actor, 'linked instance context', item.revision, item.updatedAt);
        return item;
    }

    listEvents(limit = 50): DashboardWorkspaceEvent[] {
        const rows = this.db.prepare(`
            SELECT * FROM dashboard_workspace_events
            ORDER BY created_at DESC
            LIMIT ?
        `).all(Math.max(1, Math.min(200, limit))) as EventRow[];
        return rows.map(rowToEvent);
    }

    snapshot(): DashboardWorkspaceSnapshot {
        const items = this.listItems();
        const board: Record<string, DashboardWorkItem[]> = {};
        const matrix: Record<DashboardMatrixBucket, DashboardWorkItem[]> = {
            urgentImportant: [],
            important: [],
            waiting: [],
            later: [],
        };
        for (const item of items) {
            board[item.boardLane] = [...(board[item.boardLane] ?? []), item];
            matrix[item.matrixBucket].push(item);
        }
        return { items, board, matrix, events: this.listEvents(50) };
    }

    private mergeItem(current: DashboardWorkItem, patch: DashboardWorkItemPatch, actor: DashboardWorkspaceActor): DashboardWorkItem {
        const at = nowIso();
        return {
            ...current,
            title: Object.hasOwn(patch, 'title') ? requireText(patch.title, 'title', MAX_TITLE) : current.title,
            body: Object.hasOwn(patch, 'body') ? optionalText(patch.body, 'body', MAX_TEXT) ?? '' : current.body,
            status: Object.hasOwn(patch, 'status') ? pickStatus(patch.status, current.status) : current.status,
            priority: Object.hasOwn(patch, 'priority') ? pickPriority(patch.priority, current.priority) : current.priority,
            matrixBucket: Object.hasOwn(patch, 'matrixBucket') ? pickBucket(patch.matrixBucket, current.matrixBucket) : current.matrixBucket,
            boardLane: Object.hasOwn(patch, 'boardLane') ? optionalText(patch.boardLane, 'boardLane', MAX_LANE) ?? current.boardLane : current.boardLane,
            dueAt: Object.hasOwn(patch, 'dueAt') ? optionalText(patch.dueAt, 'dueAt', 80) : current.dueAt,
            remindAt: Object.hasOwn(patch, 'remindAt') ? optionalText(patch.remindAt, 'remindAt', 80) : current.remindAt,
            notePaths: Object.hasOwn(patch, 'notePaths') ? normalizeNotePaths(patch.notePaths) : current.notePaths,
            instanceLinks: Object.hasOwn(patch, 'instanceLinks') ? normalizeInstanceLinks(patch.instanceLinks) : current.instanceLinks,
            updatedBy: actor,
            revision: current.revision + 1,
            updatedAt: at,
        };
    }

    private writeItem(item: DashboardWorkItem): void {
        this.db.prepare(`
            UPDATE dashboard_work_items SET
                title = ?, body = ?, status = ?, priority = ?, matrix_bucket = ?, board_lane = ?,
                due_at = ?, remind_at = ?, note_paths_json = ?, instance_links_json = ?,
                updated_by = ?, revision = ?, updated_at = ?
            WHERE id = ?
        `).run(
            item.title, item.body, item.status, item.priority, item.matrixBucket, item.boardLane,
            item.dueAt, item.remindAt, JSON.stringify(item.notePaths), JSON.stringify(item.instanceLinks),
            item.updatedBy, item.revision, item.updatedAt, item.id,
        );
    }

    private syncNoteLinks(item: DashboardWorkItem): void {
        this.db.prepare('DELETE FROM dashboard_workspace_note_links WHERE item_id = ?').run(item.id);
        const insert = this.db.prepare('INSERT OR IGNORE INTO dashboard_workspace_note_links (item_id, note_path, created_at) VALUES (?, ?, ?)');
        for (const notePath of item.notePaths) insert.run(item.id, notePath, item.updatedAt);
    }

    private recordEvent(itemId: string, kind: DashboardWorkspaceEventKind, actor: DashboardWorkspaceActor, summary: string, revision: number, at: string): void {
        this.db.prepare(`
            INSERT INTO dashboard_workspace_events (id, item_id, kind, actor, summary, revision, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), itemId, kind, actor, summary, revision, at);
    }
}

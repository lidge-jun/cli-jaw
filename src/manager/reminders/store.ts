import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { dashboardPath } from '../dashboard-home.js';
import type { Reminder, ReminderPriority, ReminderSnapshot, ReminderStatus, ReminderSubtask } from '../../reminders/types.js';
import { parseReminderInstanceLink, type ReminderInstanceLinkInput } from './instance-link.js';

export type DashboardReminderSource = 'jaw-reminders' | 'cli-jaw-local';
export type DashboardReminderNotificationStatus =
    | 'pending'
    | 'delivered'
    | 'no_channel'
    | 'failed'
    | 'invalid_remind_at';

export type DashboardReminder = {
    id: string;
    title: string;
    notes: string;
    listId: string;
    status: ReminderStatus;
    priority: ReminderPriority;
    dueAt: string | null;
    remindAt: string | null;
    linkedInstance: string | null;
    subtasks: ReminderSubtask[];
    source: DashboardReminderSource;
    sourceCreatedAt: string;
    sourceUpdatedAt: string;
    mirroredAt: string;
    notificationStatus: DashboardReminderNotificationStatus;
    notificationAttemptedAt: string | null;
    notificationError: string | null;
    instanceId: string | null;
    messageId: string | null;
    turnIndex: number | null;
    port: number | null;
    threadKey: string | null;
    sourceText: string | null;
};

export type DashboardReminderInput = {
    title: string;
    notes?: string | null;
    status?: ReminderStatus | undefined;
    priority?: ReminderPriority | undefined;
    dueAt?: string | null;
    remindAt?: string | null;
    listId?: string | null;
    linkedInstance?: string | null;
    sourceText?: string | null;
    link?: ReminderInstanceLinkInput | null;
};

export type DashboardReminderPatch = Partial<Pick<DashboardReminderInput, 'title' | 'notes' | 'status' | 'priority' | 'dueAt' | 'remindAt' | 'linkedInstance'>>;

type Row = {
    id: string;
    title: string;
    notes: string;
    list_id: string;
    status: string;
    priority: string;
    due_at: string | null;
    remind_at: string | null;
    linked_instance: string | null;
    subtasks_json: string;
    source: string;
    source_created_at: string;
    source_updated_at: string;
    mirrored_at: string;
    notification_status: string;
    notification_attempted_at: string | null;
    notification_error: string | null;
    instance_id: string | null;
    message_id: string | null;
    turn_index: number | null;
    port: number | null;
    thread_key: string | null;
    source_text: string | null;
};

const REMINDER_STATUSES: readonly ReminderStatus[] = ['open', 'focused', 'waiting', 'done'];
const REMINDER_PRIORITIES: readonly ReminderPriority[] = ['low', 'normal', 'high'];
const REMINDER_SOURCES: readonly DashboardReminderSource[] = ['jaw-reminders', 'cli-jaw-local'];
const NOTIFICATION_STATUSES: readonly DashboardReminderNotificationStatus[] = [
    'pending',
    'delivered',
    'no_channel',
    'failed',
    'invalid_remind_at',
];

function ensureDir(p: string): void {
    const d = dirname(p);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function normalizeStatus(value: string): ReminderStatus {
    return REMINDER_STATUSES.includes(value as ReminderStatus) ? value as ReminderStatus : 'open';
}

function normalizePriority(value: string): ReminderPriority {
    return REMINDER_PRIORITIES.includes(value as ReminderPriority) ? value as ReminderPriority : 'normal';
}

function normalizeSource(value: string): DashboardReminderSource {
    return REMINDER_SOURCES.includes(value as DashboardReminderSource)
        ? value as DashboardReminderSource
        : 'jaw-reminders';
}

function normalizeNotificationStatus(value: string): DashboardReminderNotificationStatus {
    return NOTIFICATION_STATUSES.includes(value as DashboardReminderNotificationStatus)
        ? value as DashboardReminderNotificationStatus
        : 'pending';
}

function parseSubtasks(raw: string, reminderId: string): ReminderSubtask[] {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            console.warn(`[reminders-store] reminder ${reminderId} subtasks_json is not an array`);
            return [];
        }
        return parsed.filter((entry): entry is ReminderSubtask => {
            return typeof entry === 'object'
                && entry !== null
                && typeof (entry as ReminderSubtask).id === 'string'
                && typeof (entry as ReminderSubtask).title === 'string'
                && typeof (entry as ReminderSubtask).done === 'boolean';
        });
    } catch (error) {
        console.warn(`[reminders-store] reminder ${reminderId} subtasks_json parse failed: ${(error as Error).message}`);
        return [];
    }
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number): string | null {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (text.length > maxLength) throw new Error('text too long');
    return text;
}

function shouldResetNotification(
    current: Pick<DashboardReminder, 'dueAt' | 'remindAt'>,
    nextDueAt: string | null,
    nextRemindAt: string | null,
    nextStatus: ReminderStatus,
): boolean {
    if (nextStatus === 'done') return false;
    return current.dueAt !== nextDueAt || current.remindAt !== nextRemindAt;
}

function rowToReminder(row: Row): DashboardReminder {
    return {
        id: row.id,
        title: row.title,
        notes: row.notes,
        listId: row.list_id,
        status: normalizeStatus(row.status),
        priority: normalizePriority(row.priority),
        dueAt: row.due_at,
        remindAt: row.remind_at,
        linkedInstance: row.linked_instance,
        subtasks: parseSubtasks(row.subtasks_json, row.id),
        source: normalizeSource(row.source),
        sourceCreatedAt: row.source_created_at,
        sourceUpdatedAt: row.source_updated_at,
        mirroredAt: row.mirrored_at,
        notificationStatus: normalizeNotificationStatus(row.notification_status),
        notificationAttemptedAt: row.notification_attempted_at,
        notificationError: row.notification_error,
        instanceId: row.instance_id,
        messageId: row.message_id,
        turnIndex: row.turn_index,
        port: row.port,
        threadKey: row.thread_key,
        sourceText: row.source_text,
    };
}

export type RemindersStoreOptions = { dbPath?: string };

export class RemindersStore {
    private readonly db: Database.Database;

    constructor(options: RemindersStoreOptions = {}) {
        const path = options.dbPath || dashboardPath('dashboard.db');
        ensureDir(path);
        this.db = new Database(path);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS dashboard_reminders (
                id                         TEXT PRIMARY KEY,
                title                      TEXT NOT NULL,
                notes                      TEXT NOT NULL DEFAULT '',
                list_id                    TEXT NOT NULL,
                status                     TEXT NOT NULL,
                priority                   TEXT NOT NULL,
                due_at                     TEXT,
                remind_at                  TEXT,
                linked_instance            TEXT,
                subtasks_json              TEXT NOT NULL DEFAULT '[]',
                source                     TEXT NOT NULL DEFAULT 'jaw-reminders',
                source_created_at          TEXT NOT NULL,
                source_updated_at          TEXT NOT NULL,
                mirrored_at                TEXT NOT NULL,
                notification_status        TEXT NOT NULL DEFAULT 'pending',
                notification_attempted_at  TEXT,
                notification_error         TEXT,
                instance_id                TEXT,
                message_id                 TEXT,
                turn_index                 INTEGER,
                port                       INTEGER,
                thread_key                 TEXT,
                source_text                TEXT
            );
        `);
        this.ensureColumn('notification_status', "TEXT NOT NULL DEFAULT 'pending'");
        this.ensureColumn('notification_attempted_at', 'TEXT');
        this.ensureColumn('notification_error', 'TEXT');
        this.ensureColumn('instance_id', 'TEXT');
        this.ensureColumn('message_id', 'TEXT');
        this.ensureColumn('turn_index', 'INTEGER');
        this.ensureColumn('port', 'INTEGER');
        this.ensureColumn('thread_key', 'TEXT');
        this.ensureColumn('source_text', 'TEXT');
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_dashboard_reminders_status ON dashboard_reminders(status);
            CREATE INDEX IF NOT EXISTS idx_dashboard_reminders_remind_at ON dashboard_reminders(remind_at);
            CREATE INDEX IF NOT EXISTS idx_dashboard_reminders_source ON dashboard_reminders(source);
            CREATE INDEX IF NOT EXISTS idx_dashboard_reminders_notification ON dashboard_reminders(notification_status);
        `);
    }

    private ensureColumn(name: string, ddl: string): void {
        const rows = this.db.prepare('PRAGMA table_info(dashboard_reminders)').all() as Array<{ name: string }>;
        if (rows.some(row => row.name === name)) return;
        this.db.exec(`ALTER TABLE dashboard_reminders ADD COLUMN ${name} ${ddl}`);
    }

    list(): DashboardReminder[] {
        const rows = this.db.prepare(`
            SELECT * FROM dashboard_reminders
            ORDER BY
                CASE status
                    WHEN 'focused' THEN 0
                    WHEN 'open' THEN 1
                    WHEN 'waiting' THEN 2
                    WHEN 'done' THEN 3
                    ELSE 4
                END,
                COALESCE(remind_at, due_at, source_updated_at) ASC
        `).all() as Row[];
        return rows.map(rowToReminder);
    }

    get(id: string): DashboardReminder | null {
        const row = this.db.prepare('SELECT * FROM dashboard_reminders WHERE id = ?').get(id) as Row | undefined;
        return row ? rowToReminder(row) : null;
    }

    createLocal(input: DashboardReminderInput): DashboardReminder {
        const title = String(input.title || '').trim();
        if (!title) throw new Error('title required');
        if (title.length > 500) throw new Error('title too long');
        if (input.status !== undefined && !REMINDER_STATUSES.includes(input.status)) throw new Error('invalid status');
        if (input.priority !== undefined && !REMINDER_PRIORITIES.includes(input.priority)) throw new Error('invalid priority');
        const link = input.link ? parseReminderInstanceLink(input.link) : null;
        const id = `rem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();
        this.db.prepare(`
            INSERT INTO dashboard_reminders (
                id, title, notes, list_id, status, priority, due_at, remind_at, linked_instance,
                subtasks_json, source, source_created_at, source_updated_at, mirrored_at,
                instance_id, message_id, turn_index, port, thread_key, source_text
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'cli-jaw-local', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            title,
            normalizeOptionalText(input.notes, 20000) ?? '',
            normalizeOptionalText(input.listId, 200) ?? 'cli-jaw',
            input.status ?? 'open',
            input.priority ?? 'normal',
            input.dueAt ?? null,
            input.remindAt ?? null,
            input.linkedInstance ?? (link?.port ? String(link.port) : null),
            now,
            now,
            now,
            link?.instanceId ?? null,
            link?.messageId ?? null,
            link?.turnIndex ?? null,
            link?.port ?? null,
            link?.threadKey ?? null,
            link?.sourceText ?? normalizeOptionalText(input.sourceText, 20000),
        );
        const created = this.get(id);
        if (!created) throw new Error('reminder creation failed');
        return created;
    }

    updateLocal(id: string, patch: DashboardReminderPatch): DashboardReminder | null {
        const existing = this.get(id);
        if (!existing) return null;
        if (existing.source !== 'cli-jaw-local') throw new Error('only cli-jaw-local reminders are writable');
        const fields: string[] = [];
        const values: unknown[] = [];
        if (patch.title !== undefined) {
            const title = String(patch.title).trim();
            if (!title || title.length > 500) throw new Error('invalid title');
            fields.push('title = ?'); values.push(title);
        }
        if (patch.notes !== undefined) { fields.push('notes = ?'); values.push(normalizeOptionalText(patch.notes, 20000) ?? ''); }
        if (patch.status !== undefined) {
            if (!REMINDER_STATUSES.includes(patch.status)) throw new Error('invalid status');
            fields.push('status = ?'); values.push(patch.status);
        }
        if (patch.priority !== undefined) {
            if (!REMINDER_PRIORITIES.includes(patch.priority)) throw new Error('invalid priority');
            fields.push('priority = ?'); values.push(patch.priority);
        }
        const nextStatus = patch.status !== undefined ? patch.status : existing.status;
        const nextDueAt = patch.dueAt !== undefined ? patch.dueAt : existing.dueAt;
        const nextRemindAt = patch.remindAt !== undefined ? patch.remindAt : existing.remindAt;
        if (patch.dueAt !== undefined) { fields.push('due_at = ?'); values.push(patch.dueAt); }
        if (patch.remindAt !== undefined) { fields.push('remind_at = ?'); values.push(patch.remindAt); }
        if (patch.linkedInstance !== undefined) { fields.push('linked_instance = ?'); values.push(patch.linkedInstance); }
        if (shouldResetNotification(existing, nextDueAt, nextRemindAt, nextStatus)) {
            fields.push("notification_status = 'pending'");
            fields.push('notification_attempted_at = NULL');
            fields.push('notification_error = NULL');
        }
        if (fields.length === 0) return existing;
        fields.push('source_updated_at = ?'); values.push(new Date().toISOString());
        fields.push('mirrored_at = ?'); values.push(new Date().toISOString());
        values.push(id);
        this.db.prepare(`UPDATE dashboard_reminders SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.get(id);
    }

    upsertFromSnapshot(snapshot: ReminderSnapshot, mirroredAt = new Date().toISOString()): number {
        const upsert = this.db.prepare(`
            INSERT INTO dashboard_reminders (
                id, title, notes, list_id, status, priority, due_at, remind_at, linked_instance,
                subtasks_json, source, source_created_at, source_updated_at, mirrored_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'jaw-reminders', ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                notes = excluded.notes,
                list_id = excluded.list_id,
                status = excluded.status,
                priority = excluded.priority,
                due_at = excluded.due_at,
                remind_at = excluded.remind_at,
                linked_instance = excluded.linked_instance,
                subtasks_json = excluded.subtasks_json,
                source = 'jaw-reminders',
                source_updated_at = excluded.source_updated_at,
                mirrored_at = excluded.mirrored_at,
                notification_status = CASE
                    WHEN excluded.status = 'done' THEN dashboard_reminders.notification_status
                    WHEN dashboard_reminders.due_at IS NOT excluded.due_at OR dashboard_reminders.remind_at IS NOT excluded.remind_at THEN 'pending'
                    ELSE dashboard_reminders.notification_status
                END,
                notification_attempted_at = CASE
                    WHEN excluded.status = 'done' THEN dashboard_reminders.notification_attempted_at
                    WHEN dashboard_reminders.due_at IS NOT excluded.due_at OR dashboard_reminders.remind_at IS NOT excluded.remind_at THEN NULL
                    ELSE dashboard_reminders.notification_attempted_at
                END,
                notification_error = CASE
                    WHEN excluded.status = 'done' THEN dashboard_reminders.notification_error
                    WHEN dashboard_reminders.due_at IS NOT excluded.due_at OR dashboard_reminders.remind_at IS NOT excluded.remind_at THEN NULL
                    ELSE dashboard_reminders.notification_error
                END
        `);
        const deleteMissing = this.db.prepare(`
            DELETE FROM dashboard_reminders
            WHERE source = 'jaw-reminders' AND id NOT IN (${snapshot.reminders.map(() => '?').join(',') || "''"})
        `);
        const sync = this.db.transaction((reminders: Reminder[]) => {
            let changes = 0;
            for (const reminder of reminders) {
                const result = upsert.run(
                    reminder.id,
                    reminder.title,
                    reminder.notes,
                    reminder.listId,
                    reminder.status,
                    reminder.priority,
                    reminder.dueAt,
                    reminder.remindAt,
                    reminder.linkedInstance,
                    JSON.stringify(reminder.subtasks),
                    reminder.createdAt,
                    reminder.updatedAt,
                    mirroredAt,
                );
                changes += result.changes;
            }
            const ids = reminders.map(reminder => reminder.id);
            changes += deleteMissing.run(...ids).changes;
            return changes;
        });
        return sync(snapshot.reminders);
    }

    markNotificationAttempt(
        id: string,
        status: DashboardReminderNotificationStatus,
        error: string | null,
        attemptedAt = new Date().toISOString(),
    ): DashboardReminder | null {
        const result = this.db.prepare(`
            UPDATE dashboard_reminders
            SET notification_status = ?, notification_attempted_at = ?, notification_error = ?
            WHERE id = ?
        `).run(status, attemptedAt, error, id);
        return result.changes > 0 ? this.get(id) : null;
    }

    close(): void { this.db.close(); }
}

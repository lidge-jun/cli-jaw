import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { dashboardPath } from '../dashboard-home.js';

export type DashboardScheduleGroup = 'today' | 'upcoming' | 'recurring' | 'blocked';
export const SCHEDULE_GROUPS: readonly DashboardScheduleGroup[] = ['today', 'upcoming', 'recurring', 'blocked'] as const;

function isGroup(v: unknown): v is DashboardScheduleGroup {
    return typeof v === 'string' && (SCHEDULE_GROUPS as readonly string[]).includes(v);
}

export type DashboardScheduledWork = {
    id: string;
    title: string;
    group: DashboardScheduleGroup;
    cron: string | null;
    runAt: string | null;
    targetPort: number | null;
    payload: string | null;
    enabled: boolean;
    lastRunAt: string | null;
    lastStatus: string | null;
    nextRunAt: string | null;
    createdAt: string;
    updatedAt: string;
};

export type DashboardScheduledWorkInput = {
    title: string;
    group?: DashboardScheduleGroup;
    cron?: string | null;
    runAt?: string | null;
    targetPort?: number | null;
    payload?: string | null;
    enabled?: boolean;
};

export type DashboardScheduledWorkPatch = Partial<DashboardScheduledWorkInput>;

type Row = {
    id: string;
    title: string;
    group_id: string;
    cron: string | null;
    run_at: string | null;
    target_port: number | null;
    payload: string | null;
    enabled: number;
    last_run_at: string | null;
    last_status: string | null;
    next_run_at: string | null;
    created_at: string;
    updated_at: string;
};

function rowToSchedule(row: Row): DashboardScheduledWork {
    const group: DashboardScheduleGroup = isGroup(row.group_id) ? row.group_id : 'upcoming';
    return {
        id: row.id,
        title: row.title,
        group,
        cron: row.cron,
        runAt: row.run_at,
        targetPort: row.target_port,
        payload: row.payload,
        enabled: row.enabled === 1,
        lastRunAt: row.last_run_at,
        lastStatus: row.last_status,
        nextRunAt: row.next_run_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function ensureDir(p: string) {
    const d = dirname(p);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

export type ScheduleStoreOptions = { dbPath?: string };

export class ScheduleStore {
    private readonly db: Database.Database;

    constructor(options: ScheduleStoreOptions = {}) {
        const path = options.dbPath || dashboardPath('dashboard.db');
        ensureDir(path);
        this.db = new Database(path);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS dashboard_scheduled_work (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL,
                group_id    TEXT NOT NULL DEFAULT 'upcoming',
                cron        TEXT,
                run_at      TEXT,
                target_port INTEGER,
                payload     TEXT,
                enabled     INTEGER NOT NULL DEFAULT 1,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_scheduled_work_group ON dashboard_scheduled_work(group_id);
            CREATE INDEX IF NOT EXISTS idx_scheduled_work_run_at ON dashboard_scheduled_work(run_at);
        `);
        // Idempotent column additions for runner observability (last/next run).
        this.migrateColumn('last_run_at', 'TEXT');
        this.migrateColumn('last_status', 'TEXT');
        this.migrateColumn('next_run_at', 'TEXT');
    }

    private migrateColumn(name: string, type: string): void {
        const cols = this.db.prepare('PRAGMA table_info(dashboard_scheduled_work)').all() as { name: string }[];
        if (cols.some(c => c.name === name)) return;
        this.db.exec(`ALTER TABLE dashboard_scheduled_work ADD COLUMN ${name} ${type}`);
    }

    /** Mark a scheduled run attempt outcome. Used by the manager scheduler runner. */
    markRun(id: string, status: string, nextRunAt: string | null): void {
        this.db.prepare(
            "UPDATE dashboard_scheduled_work SET last_run_at = datetime('now'), last_status = ?, next_run_at = ?, updated_at = datetime('now') WHERE id = ?",
        ).run(status, nextRunAt, id);
    }

    list(): DashboardScheduledWork[] {
        const rows = this.db.prepare('SELECT * FROM dashboard_scheduled_work ORDER BY updated_at DESC').all() as Row[];
        return rows.map(rowToSchedule);
    }

    get(id: string): DashboardScheduledWork | null {
        const row = this.db.prepare('SELECT * FROM dashboard_scheduled_work WHERE id = ?').get(id) as Row | undefined;
        return row ? rowToSchedule(row) : null;
    }

    create(input: DashboardScheduledWorkInput): DashboardScheduledWork {
        const id = `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        if (input.group !== undefined && !isGroup(input.group)) throw new Error('invalid group');
        const group: DashboardScheduleGroup = input.group ?? 'upcoming';
        const title = String(input.title || '').trim();
        if (!title) throw new Error('title required');
        if (title.length > 500) throw new Error('title too long');
        this.db.prepare(`
            INSERT INTO dashboard_scheduled_work (id, title, group_id, cron, run_at, target_port, payload, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            title,
            group,
            input.cron ?? null,
            input.runAt ?? null,
            input.targetPort ?? null,
            input.payload ?? null,
            input.enabled === false ? 0 : 1,
        );
        const created = this.get(id);
        if (!created) throw new Error('scheduled work creation failed');
        return created;
    }

    update(id: string, patch: DashboardScheduledWorkPatch): DashboardScheduledWork | null {
        const existing = this.get(id);
        if (!existing) return null;
        const fields: string[] = [];
        const values: unknown[] = [];
        if (patch.title !== undefined) {
            const t = String(patch.title).trim();
            if (!t || t.length > 500) throw new Error('invalid title');
            fields.push('title = ?'); values.push(t);
        }
        if (patch.group !== undefined) {
            if (!isGroup(patch.group)) throw new Error('invalid group');
            fields.push('group_id = ?'); values.push(patch.group);
        }
        if (patch.cron !== undefined) { fields.push('cron = ?'); values.push(patch.cron); }
        if (patch.runAt !== undefined) { fields.push('run_at = ?'); values.push(patch.runAt); }
        if (patch.targetPort !== undefined) { fields.push('target_port = ?'); values.push(patch.targetPort); }
        if (patch.payload !== undefined) { fields.push('payload = ?'); values.push(patch.payload); }
        if (patch.enabled !== undefined) { fields.push('enabled = ?'); values.push(patch.enabled ? 1 : 0); }
        if (fields.length === 0) return existing;
        fields.push("updated_at = datetime('now')");
        values.push(id);
        this.db.prepare(`UPDATE dashboard_scheduled_work SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return this.get(id);
    }

    remove(id: string): boolean {
        const r = this.db.prepare('DELETE FROM dashboard_scheduled_work WHERE id = ?').run(id);
        return r.changes > 0;
    }

    /**
     * Atomically claim an enabled item for dispatch only if it still matches
     * the dispatched snapshot. Wraps the read+UPDATE in an IMMEDIATE
     * transaction so a concurrent PATCH on the same row cannot slip in
     * between decision and claim.
     *
     * Returns:
     *   { ok: true, item } when the claim succeeded
     *   { ok: false, reason: 'gone' } if the row was removed
     *   { ok: false, reason: 'changed' } if enabled flipped or targetPort changed
     */
    claimForDispatch(
        id: string,
        expected: { enabled: boolean; targetPort: number | null },
    ): { ok: true; item: DashboardScheduledWork } | { ok: false; reason: 'gone' | 'changed' } {
        const txn = this.db.transaction(() => {
            const row = this.db
                .prepare('SELECT * FROM dashboard_scheduled_work WHERE id = ?')
                .get(id) as Row | undefined;
            if (!row) return { ok: false as const, reason: 'gone' as const };
            const isEnabled = row.enabled === 1;
            const port = row.target_port;
            if (isEnabled !== expected.enabled || port !== expected.targetPort) {
                return { ok: false as const, reason: 'changed' as const };
            }
            const r = this.db
                .prepare("UPDATE dashboard_scheduled_work SET enabled = 0, updated_at = datetime('now') WHERE id = ? AND enabled = 1")
                .run(id);
            if (r.changes !== 1) return { ok: false as const, reason: 'changed' as const };
            const after = this.get(id);
            if (!after) return { ok: false as const, reason: 'gone' as const };
            return { ok: true as const, item: after };
        });
        return txn.immediate();
    }

    close(): void { this.db.close(); }
}

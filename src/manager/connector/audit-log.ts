import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { dashboardPath } from '../dashboard-home.js';
import type { ConnectorActor, ConnectorAuditEvent, ConnectorInstanceLink, ConnectorSurface } from './types.js';

type Row = {
    id: string;
    surface: string;
    action: string;
    target_id: string | null;
    actor: string;
    instance_port: number | null;
    instance_thread: string | null;
    instance_message: string | null;
    created_at: string;
};

function ensureDir(filePath: string): void {
    const d = dirname(filePath);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function rowToEvent(row: Row): ConnectorAuditEvent {
    const hasLink = row.instance_port !== null || row.instance_thread !== null || row.instance_message !== null;
    const instanceLink: ConnectorInstanceLink | null = hasLink
        ? {
            port: row.instance_port,
            threadKey: row.instance_thread,
            messageId: row.instance_message,
        }
        : null;
    return {
        id: row.id,
        surface: row.surface as ConnectorSurface,
        action: row.action,
        targetId: row.target_id,
        actor: row.actor as ConnectorActor,
        instanceLink,
        createdAt: row.created_at,
    };
}

export type ConnectorAuditAppend = {
    surface: ConnectorSurface;
    action: string;
    targetId: string | null;
    actor: ConnectorActor;
    instanceLink: ConnectorInstanceLink | null;
};

export type ConnectorAuditLogOptions = { dbPath?: string };

export class ConnectorAuditLog {
    private readonly db: Database.Database;

    constructor(options: ConnectorAuditLogOptions = {}) {
        const path = options.dbPath || dashboardPath('dashboard.db');
        ensureDir(path);
        this.db = new Database(path);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS dashboard_connector_audit (
                id                TEXT PRIMARY KEY,
                surface           TEXT NOT NULL,
                action            TEXT NOT NULL,
                target_id         TEXT,
                actor             TEXT NOT NULL,
                instance_port     INTEGER,
                instance_thread   TEXT,
                instance_message  TEXT,
                created_at        TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_dashboard_connector_audit_created
              ON dashboard_connector_audit(created_at DESC);
        `);
    }

    append(entry: ConnectorAuditAppend): ConnectorAuditEvent {
        const id = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const createdAt = new Date().toISOString();
        const link = entry.instanceLink;
        this.db.prepare(`
            INSERT INTO dashboard_connector_audit (
                id, surface, action, target_id, actor,
                instance_port, instance_thread, instance_message, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            entry.surface,
            entry.action,
            entry.targetId,
            entry.actor,
            link?.port ?? null,
            link?.threadKey ?? null,
            link?.messageId ?? null,
            createdAt,
        );
        return {
            id,
            surface: entry.surface,
            action: entry.action,
            targetId: entry.targetId,
            actor: entry.actor,
            instanceLink: link,
            createdAt,
        };
    }

    list(limit = 50): ConnectorAuditEvent[] {
        const safeLimit = Number.isFinite(limit) && limit > 0 && limit <= 500 ? Math.floor(limit) : 50;
        const rows = this.db.prepare(`
            SELECT * FROM dashboard_connector_audit
            ORDER BY created_at DESC
            LIMIT ?
        `).all(safeLimit) as Row[];
        return rows.map(rowToEvent);
    }

    close(): void {
        this.db.close();
    }
}

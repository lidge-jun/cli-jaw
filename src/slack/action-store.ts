import type { Database as SqliteDatabase } from 'better-sqlite3';

export type ActionResource = { workspace: string; kind: string; id: string; actor: string; channel: string; botUserId: string; credentialKey: string; status: 'active' | 'retired'; metadata: Record<string, unknown> };
export type StoredAction = { request_hash: string; status: string; receipt_json: string | null };
const INVOCATION_CAP = 100000;
const RESOURCE_CAP = 10000;
export class SlackActionStore {
    constructor(private readonly database: SqliteDatabase) {
        database.exec(`CREATE TABLE IF NOT EXISTS slack_tool_invocations (
            workspace TEXT NOT NULL, actor TEXT NOT NULL, invocation_id TEXT NOT NULL,
            request_hash TEXT NOT NULL, status TEXT NOT NULL, receipt_json TEXT,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            PRIMARY KEY(workspace,actor,invocation_id));
            CREATE TABLE IF NOT EXISTS slack_tool_resources (
            workspace TEXT NOT NULL, kind TEXT NOT NULL, resource_id TEXT NOT NULL,
            actor TEXT NOT NULL, channel TEXT NOT NULL, bot_user_id TEXT NOT NULL,
            credential_key TEXT NOT NULL, status TEXT NOT NULL, metadata_json TEXT NOT NULL,
            PRIMARY KEY(workspace,kind,resource_id));
            CREATE TABLE IF NOT EXISTS slack_tool_verified (
            workspace TEXT NOT NULL, credential_key TEXT NOT NULL, operation TEXT NOT NULL,
            verified_at INTEGER NOT NULL, PRIMARY KEY(workspace,credential_key,operation));`);
    }
    invocation(workspace: string, actor: string, id: string): StoredAction | undefined {
        return this.database.prepare('SELECT request_hash,status,receipt_json FROM slack_tool_invocations WHERE workspace=? AND actor=? AND invocation_id=?').get(workspace, actor, id) as StoredAction | undefined;
    }
    reserve(workspace: string, actor: string, id: string, hash: string): boolean {
        return this.database.transaction(() => {
            const count = this.database.prepare('SELECT count(*) AS n FROM slack_tool_invocations').get() as { n: number };
            if (count.n >= INVOCATION_CAP) return false;
            const now = Date.now();
            return this.database.prepare('INSERT OR IGNORE INTO slack_tool_invocations VALUES (?,?,?,?,?,?,?,?)').run(workspace, actor, id, hash, 'reserved', null, now, now).changes === 1;
        })();
    }
    dispatched(workspace: string, actor: string, id: string): void {
        this.database.prepare("UPDATE slack_tool_invocations SET status='dispatched',updated_at=? WHERE workspace=? AND actor=? AND invocation_id=? AND status IN ('reserved','dispatched')").run(Date.now(), workspace, actor, id);
    }
    finish(workspace: string, actor: string, id: string, status: 'completed' | 'failed' | 'unknown', receipt: unknown): void {
        const json = JSON.stringify(receipt);
        if (Buffer.byteLength(json) > 16384) throw new Error('slack_action_receipt_too_large');
        this.database.prepare('UPDATE slack_tool_invocations SET status=?,receipt_json=?,updated_at=? WHERE workspace=? AND actor=? AND invocation_id=?').run(status, json, Date.now(), workspace, actor, id);
    }
    resource(workspace: string, kind: string, id: string): ActionResource | undefined {
        const row = this.database.prepare('SELECT workspace,kind,resource_id,actor,channel,bot_user_id,credential_key,status,metadata_json FROM slack_tool_resources WHERE workspace=? AND kind=? AND resource_id=?').get(workspace, kind, id) as Record<string, unknown> | undefined;
        if (!row) return undefined;
        const metadata: unknown = JSON.parse(String(row['metadata_json']));
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !['active', 'retired'].includes(String(row['status']))) throw new Error('slack_action_resource_invalid');
        return { workspace: String(row['workspace']), kind: String(row['kind']), id: String(row['resource_id']), actor: String(row['actor']), channel: String(row['channel']), botUserId: String(row['bot_user_id']), credentialKey: String(row['credential_key']), status: row['status'] as 'active' | 'retired', metadata: metadata as Record<string, unknown> };
    }
    resources(workspace: string, kind: string, channel: string, actor?: string): ActionResource[] {
        const rows = (actor === undefined
            ? this.database.prepare('SELECT resource_id FROM slack_tool_resources WHERE workspace=? AND kind=? AND channel=? LIMIT 1001').all(workspace, kind, channel)
            : this.database.prepare('SELECT resource_id FROM slack_tool_resources WHERE workspace=? AND kind=? AND channel=? AND actor=? LIMIT 1001').all(workspace, kind, channel, actor)) as Array<{ resource_id: string }>;
        if (rows.length > 1000) throw new Error('slack_action_resource_list_incomplete');
        return rows.map(row => this.resource(workspace, kind, row.resource_id)!);
    }
    remember(value: Omit<ActionResource, 'status'>): void {
        const metadata = JSON.stringify(value.metadata);
        if (Buffer.byteLength(metadata) > 262144) throw new Error('slack_action_resource_too_large');
        const existing = this.resource(value.workspace, value.kind, value.id);
        if (existing && (existing.actor !== value.actor || existing.channel !== value.channel || existing.botUserId !== value.botUserId
            || (value.kind === 'schedule' && existing.credentialKey !== value.credentialKey))) throw new Error('slack_action_resource_collision');
        const count = this.database.prepare('SELECT count(*) AS n FROM slack_tool_resources').get() as { n: number };
        if (!existing && count.n >= RESOURCE_CAP) throw new Error('slack_action_resource_capacity');
        this.database.prepare(`INSERT INTO slack_tool_resources VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(workspace,kind,resource_id) DO UPDATE SET metadata_json=excluded.metadata_json,status='active'`).run(value.workspace, value.kind, value.id, value.actor, value.channel, value.botUserId, value.credentialKey, 'active', metadata);
    }
    retire(workspace: string, kind: string, id: string): void {
        this.database.prepare("UPDATE slack_tool_resources SET status='retired',metadata_json='{}' WHERE workspace=? AND kind=? AND resource_id=?").run(workspace, kind, id);
    }
    verified(workspace: string, credentialKey: string, operation: string): number | null {
        const row = this.database.prepare('SELECT verified_at FROM slack_tool_verified WHERE workspace=? AND credential_key=? AND operation=?').get(workspace, credentialKey, operation) as { verified_at: number } | undefined;
        return row?.verified_at ?? null;
    }
    recordVerified(workspace: string, credentialKey: string, operation: string): void {
        this.database.prepare('INSERT INTO slack_tool_verified VALUES (?,?,?,?) ON CONFLICT(workspace,credential_key,operation) DO UPDATE SET verified_at=excluded.verified_at').run(workspace, credentialKey, operation, Date.now());
    }
}

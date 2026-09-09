import type { Database as SqliteDatabase } from 'better-sqlite3';

export type InteractionOption = { actionId: string; wireValue: string; value: string };
export type SlackInteraction = {
    id: string; workspace: string; channel: string; actor: string; botUserId: string; credentialKey: string;
    blockId: string; style: 'buttons' | 'select'; options: InteractionOption[]; expiresAt: number;
    messageTs: string | null; selectedValue: string | null;
};
/** Only bounded choice identities are durable: no Slack payload, token, prompt, or response URL. */
export class SlackInteractionStore {
    constructor(private readonly db: SqliteDatabase) {
        db.exec(`CREATE TABLE IF NOT EXISTS slack_choice_interactions (
            id TEXT PRIMARY KEY, workspace TEXT NOT NULL, channel TEXT NOT NULL, actor TEXT NOT NULL,
            bot_user_id TEXT NOT NULL, credential_key TEXT NOT NULL, block_id TEXT NOT NULL,
            style TEXT NOT NULL, options_json TEXT NOT NULL, expires_at INTEGER NOT NULL,
            message_ts TEXT, selected_value TEXT);`);
    }
    create(row: Omit<SlackInteraction, 'messageTs' | 'selectedValue'>, now: number): void {
        if (!/^[a-f0-9]{32}$/.test(row.id) || !row.credentialKey || !['buttons', 'select'].includes(row.style)
            || !Number.isSafeInteger(row.expiresAt) || row.expiresAt <= now || row.expiresAt > now + 900000
            || row.options.length < 1 || row.options.length > 10 || new Set(row.options.map(o => o.wireValue)).size !== row.options.length
            || row.options.some(o => !/^[A-Za-z0-9:_-]{1,128}$/.test(o.value) || !/^[a-f0-9]{32}$/.test(o.wireValue) || !/^[A-Za-z0-9:_-]{1,128}$/.test(o.actionId))) throw new Error('slack_interaction_invalid');
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM slack_choice_interactions WHERE expires_at<=?').run(now);
            const count = this.db.prepare('SELECT count(*) AS n FROM slack_choice_interactions').get() as { n: number };
            if (count.n >= 1000) throw new Error('slack_interaction_capacity');
            this.db.prepare('INSERT INTO slack_choice_interactions VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL)').run(
                row.id, row.workspace, row.channel, row.actor, row.botUserId, row.credentialKey, row.blockId, row.style, JSON.stringify(row.options), row.expiresAt);
        })();
    }
    get(id: string): SlackInteraction | undefined {
        const row = this.db.prepare('SELECT * FROM slack_choice_interactions WHERE id=?').get(id) as Record<string, unknown> | undefined;
        if (!row) return undefined;
        return { id: String(row['id']), workspace: String(row['workspace']), channel: String(row['channel']), actor: String(row['actor']),
            botUserId: String(row['bot_user_id']), credentialKey: String(row['credential_key']), blockId: String(row['block_id']), style: row['style'] as SlackInteraction['style'],
            options: JSON.parse(String(row['options_json'])) as InteractionOption[], expiresAt: Number(row['expires_at']),
            messageTs: row['message_ts'] === null ? null : String(row['message_ts']), selectedValue: row['selected_value'] === null ? null : String(row['selected_value']) };
    }
    bind(id: string, ts: string): boolean {
        if (!/^\d{1,13}\.\d{1,6}$/.test(ts)) throw new Error('slack_interaction_message_invalid');
        return this.db.prepare('UPDATE slack_choice_interactions SET message_ts=? WHERE id=? AND message_ts IS NULL AND selected_value IS NULL').run(ts, id).changes === 1;
    }
    consume(row: SlackInteraction, actionId: string, wireValue: string, now: number): boolean {
        const option = row.options.find(o => o.actionId === actionId && o.wireValue === wireValue);
        if (!option || !row.messageTs || row.selectedValue !== null || row.expiresAt <= now) return false;
        return this.db.prepare(`UPDATE slack_choice_interactions SET selected_value=? WHERE id=? AND workspace=? AND channel=? AND actor=?
            AND bot_user_id=? AND credential_key=? AND block_id=? AND message_ts=? AND selected_value IS NULL AND expires_at>? AND options_json=?`).run(
            option.value, row.id, row.workspace, row.channel, row.actor, row.botUserId, row.credentialKey, row.blockId, row.messageTs, now, JSON.stringify(row.options)).changes === 1;
    }
}

type CallbackVerified = (workspace: string, credentialKey: string, operation: string) => void;
type Configuration = { store: SlackInteractionStore; getToken: () => string; now: () => number; onVerified?: CallbackVerified };
let configured: Configuration | undefined;
export function configureSlackInteractionStore(store: SlackInteractionStore | null, options?: { getToken: () => string; now?: () => number; onVerified?: CallbackVerified }): void {
    if (store && !options) throw new Error('slack_interaction_token_provider_required');
    configured = store && options ? { store, getToken: options.getToken, now: options.now ?? Date.now, ...(options.onVerified ? { onVerified: options.onVerified } : {}) } : undefined;
}
export function isSlackInteractionReady(): boolean { return configured !== undefined; }
export function getSlackInteractionConfiguration(): Configuration | undefined { return configured; }

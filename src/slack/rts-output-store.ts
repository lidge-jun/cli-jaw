import { randomUUID } from 'node:crypto';
import type { SlackFetch } from './api.js';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { SlackHistoryMessage } from './history.js';
import { verifiedSlackWorkspace } from './verified-workspace.js';

export const RTS_OUTPUT_MARKER = 'jaw_rts_response_v1';
const EXCLUDED_TEXT = '[검색 응답은 Slack에서 확인하세요: 모델 기록에서 제외됨]';
const OUTPUT_CAP = 100000;
const HOLD_CAP = 1024;
const PUBLICATION_CAP = 100000;

export type RtsPublication = {
    lease: string; actor: string; botUserId: string; credentialKey: string; threadTs: string | null;
    expectedOutputs: number; state: 'active' | 'terminal' | 'reconciled'; terminalAt: number | null;
    knownOutputs: string[]; verified: boolean;
};
export type RtsPublicationInput = Pick<RtsPublication, 'actor' | 'botUserId' | 'credentialKey' | 'threadTs'> & { expectedOutputs: 1 };
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{1,13}\.\d{1,6}$/.test(value);

/** Stores only our newly published output addresses, never RTS source data. */
export class RtsOutputStore {
    constructor(private readonly database: SqliteDatabase) {
        database.exec(`CREATE TABLE IF NOT EXISTS slack_rts_outputs (
            workspace TEXT NOT NULL, destination TEXT NOT NULL, output_ts TEXT NOT NULL,
            PRIMARY KEY(workspace,destination,output_ts));
            CREATE TABLE IF NOT EXISTS slack_rts_holds (
            workspace TEXT NOT NULL, destination TEXT NOT NULL, invocation_id TEXT NOT NULL,
            PRIMARY KEY(workspace,destination,invocation_id));
            CREATE TABLE IF NOT EXISTS slack_rts_publications (
            workspace TEXT NOT NULL, destination TEXT NOT NULL, invocation_id TEXT NOT NULL,
            proof_json TEXT NOT NULL, PRIMARY KEY(workspace,destination,invocation_id));
            CREATE TABLE IF NOT EXISTS slack_quote_operations (
            owner_hash TEXT NOT NULL, invocation_id TEXT NOT NULL, request_hash TEXT NOT NULL,
            status TEXT NOT NULL, receipt_json TEXT,
            PRIMARY KEY(owner_hash,invocation_id));`);
    }
    quoteOperation(owner: string, invocation: string): { request_hash: string; status: string; receipt_json: string | null } | undefined {
        return this.database.prepare('SELECT request_hash,status,receipt_json FROM slack_quote_operations WHERE owner_hash=? AND invocation_id=?').get(owner, invocation) as { request_hash: string; status: string; receipt_json: string | null } | undefined;
    }
    reserveQuote(owner: string, invocation: string, hash: string): boolean {
        const count = this.database.prepare('SELECT count(*) AS n FROM slack_quote_operations').get() as { n: number };
        if (count.n >= 10000) return false;
        return this.database.prepare('INSERT OR IGNORE INTO slack_quote_operations(owner_hash,invocation_id,request_hash,status) VALUES (?,?,?,?)').run(owner, invocation, hash, 'pending').changes === 1;
    }
    settleQuote(owner: string, invocation: string, receipt?: unknown): void {
        const json = receipt === undefined ? null : JSON.stringify(receipt);
        if (json && Buffer.byteLength(json) > 4096) throw new Error('slack_quote_receipt_too_large');
        this.database.prepare('UPDATE slack_quote_operations SET status=?,receipt_json=? WHERE owner_hash=? AND invocation_id=?').run(json ? 'completed' : 'unknown', json, owner, invocation);
    }
    begin(workspace: string, destination: string, invocation: string, input?: RtsPublicationInput): boolean {
        return this.database.transaction(() => {
            const outputs = this.database.prepare('SELECT count(*) AS n FROM slack_rts_outputs').get() as { n: number };
            const holds = this.database.prepare('SELECT count(*) AS n FROM slack_rts_holds').get() as { n: number };
            const publications = this.database.prepare('SELECT count(*) AS n FROM slack_rts_publications').get() as { n: number };
            if (outputs.n >= OUTPUT_CAP || holds.n >= HOLD_CAP || (input && publications.n >= PUBLICATION_CAP)) return false;
            if (this.publication(workspace, destination, invocation)) return false;
            if (input && (input.expectedOutputs !== 1 || (input.threadTs !== null && !timestamp(input.threadTs))
                || !input.actor || !input.botUserId || !input.credentialKey)) return false;
            const inserted = this.database.prepare('INSERT OR IGNORE INTO slack_rts_holds(workspace,destination,invocation_id) VALUES (?,?,?)').run(workspace, destination, invocation).changes === 1;
            if (inserted && input) {
                const proof: RtsPublication = { ...input, lease: randomUUID(), state: 'active', terminalAt: null, knownOutputs: [], verified: false };
                this.database.prepare('INSERT INTO slack_rts_publications VALUES (?,?,?,?)').run(workspace, destination, invocation, JSON.stringify(proof));
            }
            return inserted;
        })();
    }
    record(workspace: string, destination: string, outputTs: string): void {
        const count = this.database.prepare('SELECT count(*) AS n FROM slack_rts_outputs').get() as { n: number };
        if (count.n >= OUTPUT_CAP) throw new Error('slack_rts_output_capacity');
        this.database.prepare('INSERT OR IGNORE INTO slack_rts_outputs(workspace,destination,output_ts) VALUES (?,?,?)').run(workspace, destination, outputTs);
    }
    publication(workspace: string, destination: string, invocation: string): RtsPublication | undefined {
        const row = this.database.prepare('SELECT proof_json FROM slack_rts_publications WHERE workspace=? AND destination=? AND invocation_id=?').get(workspace, destination, invocation) as { proof_json: string } | undefined;
        if (!row) return undefined;
        const proof = JSON.parse(row.proof_json) as RtsPublication;
        if (!proof || typeof proof.lease !== 'string' || !['active', 'terminal', 'reconciled'].includes(proof.state)
            || proof.expectedOutputs !== 1 || !Array.isArray(proof.knownOutputs) || proof.knownOutputs.some(id => !timestamp(id))) throw new Error('slack_rts_proof_invalid');
        return proof;
    }
    terminal(workspace: string, destination: string, invocation: string, lease: string, knownOutputs: string[], verified: boolean): void {
        this.database.transaction(() => {
            const proof = this.publication(workspace, destination, invocation);
            if (!proof || proof.lease !== lease || proof.state !== 'active') throw new Error('slack_rts_publisher_not_owned');
            if (knownOutputs.length > proof.expectedOutputs || knownOutputs.some(id => !timestamp(id))) throw new Error('slack_rts_output_count_invalid');
            const next = { ...proof, state: 'terminal', terminalAt: Date.now(), knownOutputs: [...knownOutputs], verified };
            this.database.prepare('UPDATE slack_rts_publications SET proof_json=? WHERE workspace=? AND destination=? AND invocation_id=?').run(JSON.stringify(next), workspace, destination, invocation);
        })();
    }
    reconcile(workspace: string, destination: string, invocation: string, lease: string, outputs: string[]): boolean {
        return this.database.transaction(() => {
            const proof = this.publication(workspace, destination, invocation);
            if (!proof || proof.lease !== lease || proof.state !== 'terminal' || !Number.isFinite(proof.terminalAt)
                || outputs.length !== proof.expectedOutputs || new Set(outputs).size !== outputs.length || outputs.some(id => !timestamp(id))
                || proof.knownOutputs.some(id => !outputs.includes(id))) return false;
            if (!this.database.prepare('SELECT 1 FROM slack_rts_holds WHERE workspace=? AND destination=? AND invocation_id=?').get(workspace, destination, invocation)) return false;
            for (const output of outputs) this.record(workspace, destination, output);
            this.database.prepare('UPDATE slack_rts_publications SET proof_json=? WHERE workspace=? AND destination=? AND invocation_id=?').run(JSON.stringify({ ...proof, state: 'reconciled', knownOutputs: outputs }), workspace, destination, invocation);
            this.database.prepare('DELETE FROM slack_rts_holds WHERE workspace=? AND destination=? AND invocation_id=?').run(workspace, destination, invocation);
            return true;
        })();
    }
    finish(workspace: string, destination: string, invocation: string): void {
        const proof = this.publication(workspace, destination, invocation);
        if (proof?.state === 'terminal' && proof.verified) this.reconcile(workspace, destination, invocation, proof.lease, proof.knownOutputs);
    }
    held(workspace: string, destination: string): boolean {
        return Boolean(this.database.prepare('SELECT 1 FROM slack_rts_holds WHERE workspace=? AND destination=? LIMIT 1').get(workspace, destination));
    }
    contains(workspace: string, destination: string, outputTs: string): boolean {
        return Boolean(this.database.prepare('SELECT 1 FROM slack_rts_outputs WHERE workspace=? AND destination=? AND output_ts=?').get(workspace, destination, outputTs));
    }
}

let runtimeStore: RtsOutputStore | null | undefined;
/** Undefined is the pure-library mode; the server always explicitly configures readiness. */
export function configureRtsOutputStore(store: RtsOutputStore | null | undefined): void { runtimeStore = store; }
export function getRtsOutputStore(): RtsOutputStore | null { return runtimeStore ?? null; }
export function isRtsOutput(blocks: unknown): boolean {
    return Array.isArray(blocks) && blocks.slice(0, 50).some(block => block && typeof block === 'object'
        && typeof (block as Record<string, unknown>)['block_id'] === 'string'
        && ((block as Record<string, unknown>)['block_id'] === RTS_OUTPUT_MARKER || String((block as Record<string, unknown>)['block_id']).startsWith(`${RTS_OUTPUT_MARKER}:`)));
}
export function excludedRtsMessage(ts: string, threadTs?: string): SlackHistoryMessage {
    return { ts, ...(threadTs ? { threadTs } : {}), text: EXCLUDED_TEXT, contentExcluded: true, contentTruncated: true };
}
export async function filterRtsOutputs(token: string, channel: string, messages: SlackHistoryMessage[], signal?: AbortSignal, fetchImpl?: SlackFetch): Promise<SlackHistoryMessage[]> {
    const store = runtimeStore;
    if (store === undefined) return messages;
    if (store === null) throw new Error('slack_privacy_store_unavailable');
    const workspace = await verifiedSlackWorkspace(token, { sensitiveResponse: true, ...(fetchImpl ? { fetchImpl } : {}), ...(signal ? { signal } : {}) });
    if (!workspace || signal?.aborted) throw new Error('slack_privacy_workspace_unverified');
    const held = store.held(workspace.teamId, channel);
    return messages.map(message => held || store.contains(workspace.teamId, channel, message.ts)
        ? excludedRtsMessage(message.ts, message.threadTs) : message);
}

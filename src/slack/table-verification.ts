// A successful post of fallback text does not prove a table was delivered.
import { slackApi, type SlackCallOptions } from './api.js';
import type { RemoteTarget } from '../messaging/types.js';
import type { TableShape } from './blocks.js';
import { storedRichFeatures } from './render-features.js';

type StoredMessage = { ts?: string; blocks?: unknown; attachments?: Array<{ blocks?: unknown }> };

function storedShapes(message: StoredMessage): TableShape[] {
    const all: unknown[] = [message.blocks, ...(message.attachments ?? []).map(a => a.blocks)];
    return all.flatMap(blocks => !Array.isArray(blocks) ? [] : blocks.flatMap(block => {
        if (block?.type !== 'table' || !Array.isArray(block.rows)) return [];
        const widths = block.rows.map((r: unknown) => Array.isArray(r) ? r.length : -1);
        return [{ rows: widths.length, columns: widths.every((n: number) => n === widths[0]) ? widths[0] : -1 }];
    }));
}

export async function verifySlackTables(
    token: string, target: RemoteTarget, ts: string, expected: TableShape[], options: SlackCallOptions,
    features: string[] = [],
): Promise<{ ok: boolean; verifiedTables: number; verifiedFeatures?: string[]; reason?: string }> {
    const method = target.threadId ? 'conversations.replies' : 'conversations.history';
    const result = await slackApi<{ messages?: StoredMessage[] }>(token, method, {
        channel: target.targetId,
        ...(target.threadId ? { ts: target.threadId } : {}),
        oldest: ts, latest: ts, inclusive: true, limit: 2,
    }, { ...options, form: true, timeoutMs: 10000 });
    if (!result.ok) return { ok: false, verifiedTables: 0, reason: result.error ?? 'readback_failed' };
    const message = result.data?.messages?.find(m => m.ts === ts);
    if (!message) return { ok: false, verifiedTables: 0, reason: 'posted_message_not_found' };
    const actual = storedShapes(message);
    const ok = actual.length === expected.length
        && actual.every((shape, i) => shape.rows === expected[i]?.rows && shape.columns === expected[i]?.columns);
    if (!ok) return { ok: false, verifiedTables: actual.length, reason: 'table_count_or_shape_mismatch' };
    const observed = new Set(storedRichFeatures([...(Array.isArray(message.blocks) ? message.blocks : []),
        ...(message.attachments ?? []).flatMap(a => Array.isArray(a.blocks) ? a.blocks : [])]));
    const missing = features.filter(feature => !observed.has(feature));
    return missing.length ? { ok: false, verifiedTables: actual.length, reason: `missing_rich_features:${missing.join(',')}` }
        : { ok: true, verifiedTables: actual.length, verifiedFeatures: features };
}

// A successful post of fallback text does not prove a table was delivered.
import { slackApi, type SlackCallOptions } from './api.js';
import type { RemoteTarget } from '../messaging/types.js';
import type { TableShape } from './blocks.js';
import { boundSlackContent, storedTableContent, compareTableContent, type CanonicalTable, type TableContentStatus } from './table-content.js';
import { storedRichFeatures } from './render-features.js';

export type VerificationStatus = 'verified' | 'failed' | 'unavailable';
export type SlackVerification = { ok: boolean; verification: VerificationStatus; verifiedTables: number; tableContent: TableContentStatus; verifiedFeatures?: string[]; reason?: string };

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
    features: string[] = [], content?: CanonicalTable[],
): Promise<SlackVerification> {
    const method = target.threadId ? 'conversations.replies' : 'conversations.history';
    const result = await slackApi<{ messages?: StoredMessage[] }>(token, method, {
        channel: target.targetId,
        ...(target.threadId ? { ts: target.threadId } : {}),
        oldest: ts, latest: ts, inclusive: true, limit: 2,
    }, { ...options, sensitiveResponse: true, form: true, timeoutMs: 10000, maxResponseBytes: 1048576 });
    const unchecked: TableContentStatus = content?.length ? 'unavailable' : 'not_checked';
    if (!result.ok) return { ok: false, verification: 'unavailable', verifiedTables: 0, tableContent: unchecked, reason: result.error ?? 'readback_failed' };
    try {
        boundSlackContent(result.data);
        const messages = result.data?.messages;
        if (messages !== undefined && !Array.isArray(messages)) throw new RangeError('invalid_messages');
        const message = messages?.find(m => m && m.ts === ts);
        if (!message) return { ok: false, verification: 'unavailable', verifiedTables: 0, tableContent: unchecked, reason: 'posted_message_not_found' };
        // Validate stored containers before shape/feature traversal, including legacy calls.
        if (message.attachments !== undefined && (!Array.isArray(message.attachments) || message.attachments.some(a => !a || typeof a !== 'object'))) throw new RangeError('invalid_attachments');
        const actual = storedShapes(message);
        const ok = actual.length === expected.length
            && actual.every((shape, i) => shape.rows === expected[i]?.rows && shape.columns === expected[i]?.columns);
        if (!ok) return { ok: false, verification: 'failed', verifiedTables: 0, tableContent: content?.length ? 'failed' : 'not_checked', reason: 'table_count_or_shape_mismatch' };
        const compared = content === undefined ? { ok: true, verifiedTables: actual.length } : compareTableContent(content, storedTableContent(message));
        const tableContent: TableContentStatus = content?.length ? (compared.ok ? 'verified' : 'failed') : 'not_checked';
        if (!compared.ok) return { ...compared, verification: 'failed', tableContent };
        const observed = new Set(storedRichFeatures([...(Array.isArray(message.blocks) ? message.blocks : []),
            ...(message.attachments ?? []).flatMap(a => Array.isArray(a.blocks) ? a.blocks : [])]));
        const missing = features.filter(feature => !observed.has(feature));
        return missing.length ? { ok: false, verification: 'failed', verifiedTables: compared.verifiedTables, tableContent, reason: `missing_rich_features:${missing.join(',')}` }
            : { ok: true, verification: 'verified', verifiedTables: compared.verifiedTables, tableContent, verifiedFeatures: features };
    } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        return { ok: false, verification: 'unavailable', verifiedTables: 0, tableContent: unchecked, reason: error.message };
    }
}

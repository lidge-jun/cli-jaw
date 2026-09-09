import { nextDeliverySeq, SELF_DELIVERY_TTL_MS } from '../messaging/turn-delivery.js';
import type { RemoteTarget } from '../messaging/types.js';

const MAX_RECORDS = 1024;
// Retain start proof independently of the 20-minute display window. This is
// bounded process-local deduplication, not distributed exactly-once delivery.
const RETENTION_MS = 4 * 60 * 60_000 + SELF_DELIVERY_TTL_MS;
type RecordEntry = { target: string; scope: string; anchor?: number; attempted: boolean; at: number };
type Flight = { entry: RecordEntry; promise: Promise<void> };
const validId = (value: string) => typeof value === 'string' && value.length > 0 && value.length <= 256;
function address(target: RemoteTarget): string | null {
    if (target.channel !== 'slack' || !validId(target.targetId)
        || (target.threadId !== undefined && !validId(target.threadId))) return null;
    return JSON.stringify([target.channel, target.targetId, target.threadId ?? '']);
}

export function createSlackReplyDeliveryLedger(options: { now?: () => number; nextAnchor?: () => number } = {}) {
    const now = options.now ?? Date.now;
    const nextAnchor = options.nextAnchor ?? nextDeliverySeq;
    const records = new Map<string, RecordEntry>();
    // Never evict a pending vendor operation: duplicates must join its promise.
    const flights = new Map<string, Flight>();
    function prune(): void {
        for (const [id, entry] of records) if (now() - entry.at >= RETENTION_MS) records.delete(id);
        while (records.size > MAX_RECORDS) records.delete(records.keys().next().value!);
    }
    function lookup(id: string, target: RemoteTarget): RecordEntry | undefined {
        prune();
        const key = address(target), entry = flights.get(id)?.entry ?? records.get(id);
        return key && entry?.target === key ? entry : undefined;
    }
    function remember(id: string, target: RemoteTarget, scope: string): void {
        const key = address(target);
        if (!validId(id) || !validId(scope) || !key) return;
        prune();
        const existing = flights.get(id)?.entry ?? records.get(id);
        if (existing) return; // A later notification cannot retarget a request.
        records.set(id, { target: key, scope, attempted: false, at: now() });
        prune();
    }
    function started(id: string, target: RemoteTarget, scope: string, observedAnchor?: number): number | undefined {
        remember(id, target, scope);
        const entry = lookup(id, target);
        if (!entry || entry.scope !== scope) return undefined;
        if (entry.attempted) return entry.anchor;
        if (entry.anchor === undefined) {
            const anchor = observedAnchor ?? nextAnchor();
            if (!Number.isSafeInteger(anchor) || anchor <= 0) return undefined;
            entry.anchor = anchor;
            entry.at = now();
        }
        return entry.anchor;
    }
    function deliver(id: string, target: RemoteTarget, action: (anchor: number | undefined) => Promise<void>): Promise<void> {
        const key = address(target);
        if (!key) return Promise.resolve();
        // A legacy completion without identity must not be confused with another
        // request. Preserve its existing fail-open behavior, without guessed proof.
        if (!validId(id)) return action(undefined);
        const flight = flights.get(id);
        if (flight) return flight.entry.target === key ? flight.promise : Promise.resolve();
        prune();
        const previous = records.get(id);
        if (previous && (previous.target !== key || previous.attempted)) return Promise.resolve();
        const entry = previous ?? { target: key, scope: 'default', attempted: false, at: now() };
        entry.attempted = true;
        let resolve!: () => void, reject!: (error: unknown) => void;
        const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
        flights.set(id, { entry, promise });
        records.set(id, entry);
        const finish = (failed: boolean, error?: unknown) => {
            entry.at = now();
            records.delete(id); records.set(id, entry); prune();
            flights.delete(id);
            if (failed) reject(error); else resolve();
        };
        // Invoke synchronously after the claim so the caller can reserve a body
        // lane before its producer returns and schedules the next turn.
        try { void Promise.resolve(action(entry.anchor)).then(() => finish(false), error => finish(true, error)); }
        catch (error) { finish(true, error); }
        return promise;
    }
    return {
        remember, started, deliver,
        anchor: (id: string, target: RemoteTarget) => lookup(id, target)?.anchor,
        scope: (id: string, target: RemoteTarget) => lookup(id, target)?.scope,
        claimed(id: string, _target: RemoteTarget): boolean {
            prune(); return flights.has(id) || records.get(id)?.attempted === true;
        },
    };
}

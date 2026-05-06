/**
 * G07 — action memory cache (cli-jaw TS mirror of agbrowse web-ai/action-memory.mjs).
 *
 * EXPERIMENTAL: pure store + signature-validated lookup. A drift in the
 * DOM signature must return null, forcing the caller to re-run the live
 * resolver. Not yet wired into self-heal/target-resolver in cli-jaw —
 * cross-repo parity for the cache primitive only.
 */

export interface ActionMemoryEntry {
    intentId: string;
    origin: string;
    signature: string;
    ref: string;
    lastGoodAt: string;
    hits: number;
    validations: { ok: number; fail: number };
}

export interface ActionMemorySnapshot {
    schemaVersion: 'action-memory-v1';
    entries: Record<string, ActionMemoryEntry>;
}

export const ACTION_MEMORY_SCHEMA_VERSION = 'action-memory-v1' as const;

export function actionMemoryKey(origin: string, intentId: string, signature: string): string {
    return `${origin}::${intentId}::${signature}`;
}

export interface ActionMemory {
    put(entry: ActionMemoryEntry): ActionMemoryEntry;
    get(origin: string, intentId: string, signature: string): ActionMemoryEntry | null;
    recordReplay(origin: string, intentId: string, signature: string, outcome: 'ok' | 'fail'): ActionMemoryEntry | null;
    list(origin?: string): ActionMemoryEntry[];
    clear(): void;
    snapshot(): ActionMemorySnapshot;
    size(): number;
}

export function createActionMemory(opts?: { initial?: ActionMemorySnapshot }): ActionMemory {
    const store = new Map<string, ActionMemoryEntry>();
    if (opts?.initial?.entries && opts.initial.schemaVersion === ACTION_MEMORY_SCHEMA_VERSION) {
        for (const [k, v] of Object.entries(opts.initial.entries)) {
            store.set(k, { ...v });
        }
    }
    return {
        put(entry) {
            if (!entry || !entry.origin || !entry.intentId || !entry.signature || !entry.ref) {
                throw new Error('action-memory: entry requires origin, intentId, signature, ref');
            }
            const key = actionMemoryKey(entry.origin, entry.intentId, entry.signature);
            const existing = store.get(key);
            const merged: ActionMemoryEntry = {
                ...entry,
                hits: existing ? existing.hits : (entry.hits || 0),
                validations: existing ? existing.validations : (entry.validations || { ok: 0, fail: 0 }),
                lastGoodAt: entry.lastGoodAt || new Date().toISOString(),
            };
            store.set(key, merged);
            return merged;
        },
        get(origin, intentId, signature) {
            const key = actionMemoryKey(origin, intentId, signature);
            const entry = store.get(key);
            return entry ? { ...entry } : null;
        },
        recordReplay(origin, intentId, signature, outcome) {
            const key = actionMemoryKey(origin, intentId, signature);
            const entry = store.get(key);
            if (!entry) return null;
            const updated: ActionMemoryEntry = {
                ...entry,
                hits: outcome === 'ok' ? entry.hits + 1 : entry.hits,
                validations: {
                    ok: outcome === 'ok' ? entry.validations.ok + 1 : entry.validations.ok,
                    fail: outcome === 'fail' ? entry.validations.fail + 1 : entry.validations.fail,
                },
            };
            store.set(key, updated);
            return updated;
        },
        list(origin) {
            const all = [...store.values()];
            return origin ? all.filter(e => e.origin === origin) : all;
        },
        clear() {
            store.clear();
        },
        snapshot() {
            const entries: Record<string, ActionMemoryEntry> = {};
            for (const [k, v] of store.entries()) entries[k] = { ...v };
            return { schemaVersion: ACTION_MEMORY_SCHEMA_VERSION, entries };
        },
        size() { return store.size; },
    };
}

export function validateMemoryHit(
    entry: ActionMemoryEntry | null,
    currentSignature: string,
): ActionMemoryEntry | null {
    if (!entry) return null;
    if (typeof currentSignature !== 'string' || !currentSignature) return null;
    if (entry.signature !== currentSignature) return null;
    return entry;
}

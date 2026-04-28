import type { DirtyEntry, DirtyStore } from './types';

export function createDirtyStore(): DirtyStore {
    const pending = new Map<string, DirtyEntry>();
    const listeners = new Set<() => void>();

    function notify() {
        for (const l of listeners) l();
    }

    return {
        pending,
        isDirty: () =>
            Array.from(pending.values()).some(
                (entry) => !shallowEqual(entry.value, entry.original),
            ),
        set(key, entry) {
            if (shallowEqual(entry.value, entry.original)) {
                if (pending.has(key)) {
                    pending.delete(key);
                    notify();
                }
                return;
            }
            pending.set(key, entry);
            notify();
        },
        remove(key) {
            if (pending.delete(key)) notify();
        },
        clear() {
            if (pending.size === 0) return;
            pending.clear();
            notify();
        },
        saveBundle() {
            const out: Record<string, unknown> = {};
            for (const [key, entry] of pending) {
                if (!entry.valid) continue;
                out[key] = entry.value;
            }
            return out;
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export function shallowEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
        return false;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => v === b[i]);
    }
    return JSON.stringify(a) === JSON.stringify(b);
}

// ── IndexedDB Offline Cache ──
// Caches conversation messages for offline viewing
// Auto-syncs when server reconnects

const DB_NAME = 'clijaw';
const DB_VERSION = 1;
const STORE = 'messages';

export interface CachedMessage {
    id?: number;
    role: string;
    content: string;
    timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
                store.createIndex('timestamp', 'timestamp');
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
            dbPromise = null;
            reject(req.error);
        };
    });
    return dbPromise;
}

export async function cacheMessages(messages: CachedMessage[]): Promise<void> {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.clear();
        for (const msg of messages) {
            store.add({ role: msg.role, content: msg.content, timestamp: msg.timestamp || Date.now() });
        }
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('[idb-cache] cacheMessages failed:', e);
    }
}

export async function getCachedMessages(): Promise<CachedMessage[]> {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.warn('[idb-cache] getCachedMessages failed:', e);
        return [];
    }
}

export async function appendCachedMessage(role: string, content: string): Promise<void> {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).add({ role, content, timestamp: Date.now() });
    } catch (e) {
        console.warn('[idb-cache] appendCachedMessage failed:', e);
    }
}

export async function clearCache(): Promise<void> {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
    } catch (e) {
        console.warn('[idb-cache] clearCache failed:', e);
    }
}

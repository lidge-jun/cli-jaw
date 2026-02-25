// ─── Broadcast Bus (EventEmitter-style) ──────────────
// All modules import from here to avoid circular deps.

type BroadcastListener = (type: string, data: Record<string, any>) => void;

const broadcastListeners = new Set<BroadcastListener>();
let wss: any = null;

export function setWss(w: any) { wss = w; }

export function addBroadcastListener(fn: BroadcastListener) { broadcastListeners.add(fn); }
export function removeBroadcastListener(fn: BroadcastListener) { broadcastListeners.delete(fn); }

export function broadcast(type: string, data: Record<string, any>) {
    const msg = JSON.stringify({ type, ...data, ts: Date.now() });
    if (wss) {
        wss.clients.forEach((c: any) => { if (c.readyState === 1) c.send(msg); });
    }
    for (const fn of broadcastListeners) fn(type, data);
}

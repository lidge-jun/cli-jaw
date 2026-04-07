// ── Typed Event Bus ──
// Decouples event producers (ws.ts) from consumers (ui features).
// Phase 5 infrastructure — actual migration is incremental.

type EventMap = {
    'status:change': { status: string };
    'message:new': { role: string; content: string };
    'tool:activity': { icon: string; label: string; detail?: string };
    'settings:saved': void;
};

class TypedEventBus {
    private emitter = new EventTarget();

    on<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void): () => void {
        const wrapper = ((e: CustomEvent) => handler(e.detail)) as EventListener;
        this.emitter.addEventListener(event, wrapper);
        return () => this.emitter.removeEventListener(event, wrapper);
    }

    emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
        this.emitter.dispatchEvent(new CustomEvent(event, { detail: data }));
    }
}

export const bus = new TypedEventBus();

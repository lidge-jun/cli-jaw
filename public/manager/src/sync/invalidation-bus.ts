export type InvalidationTopic = 'notes' | 'instances';

export type InvalidationEvent = {
    topics: InvalidationTopic[];
    reason: string;
    source?: 'ui' | 'iframe' | 'visibility';
    sourceId?: string;
};

const target = new EventTarget();
const EVENT_NAME = 'dashboard:invalidate';

export function publishInvalidation(event: InvalidationEvent): void {
    target.dispatchEvent(new CustomEvent<InvalidationEvent>(EVENT_NAME, { detail: event }));
}

export function subscribeInvalidation(
    topic: InvalidationTopic,
    callback: (event: InvalidationEvent) => void,
    ignoreSourceId?: string,
): () => void {
    function handler(e: Event): void {
        const detail = (e as CustomEvent<InvalidationEvent>).detail;
        if (!detail.topics.includes(topic)) return;
        if (ignoreSourceId && detail.sourceId === ignoreSourceId) return;
        callback(detail);
    }
    target.addEventListener(EVENT_NAME, handler);
    return () => target.removeEventListener(EVENT_NAME, handler);
}

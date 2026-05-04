import { useEffect, useRef } from 'react';
import { subscribeInvalidation, type InvalidationTopic } from './invalidation-bus';

export function useInvalidationSubscription(
    topic: InvalidationTopic,
    callback: () => void,
    ignoreSourceId?: string,
): void {
    const callbackRef = useRef(callback);
    callbackRef.current = callback;
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => {
        return subscribeInvalidation(topic, () => {
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => callbackRef.current(), 100);
        }, ignoreSourceId);
    }, [topic, ignoreSourceId]);
}

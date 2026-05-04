import { useEffect, useRef } from 'react';
import { publishInvalidation } from './invalidation-bus';

const MIN_STALE_MS = 30_000;

export function VisibilityBridge(): null {
    const lastRefreshRef = useRef(Date.now());

    useEffect(() => {
        function onVisible(): void {
            if (document.visibilityState !== 'visible') return;
            if (Date.now() - lastRefreshRef.current < MIN_STALE_MS) return;
            lastRefreshRef.current = Date.now();
            publishInvalidation({
                topics: ['notes', 'instances'],
                reason: 'visibility:tab-returned',
                source: 'visibility',
            });
        }
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, []);
    return null;
}

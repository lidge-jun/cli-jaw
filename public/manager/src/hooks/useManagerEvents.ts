/**
 * 10.7.3 — Manager event polling hook.
 *
 * Pulls /api/manager/events every 10 seconds while the page is visible.
 * Pauses on tab visibility change. Returns the running window of events.
 */

import { useEffect, useRef, useState } from 'react';
import { fetchManagerEvents } from '../api';
import type { ManagerEvent } from '../types';

const POLL_INTERVAL_MS = 10_000;
const MAX_EVENTS = 200;

export type ManagerEventsApi = {
    events: ManagerEvent[];
    error: string | null;
    refresh: () => Promise<void>;
};

export function useManagerEvents(): ManagerEventsApi {
    const [events, setEvents] = useState<ManagerEvent[]>([]);
    const [error, setError] = useState<string | null>(null);
    const sinceRef = useRef<string | null>(null);

    async function pull(): Promise<void> {
        try {
            const fresh = await fetchManagerEvents(sinceRef.current);
            setError(null);
            if (fresh.length === 0) return;
            sinceRef.current = fresh[fresh.length - 1].at;
            setEvents(prev => {
                const merged = [...prev, ...fresh];
                if (merged.length > MAX_EVENTS) merged.splice(0, merged.length - MAX_EVENTS);
                return merged;
            });
        } catch (err) {
            setError((err as Error).message);
        }
    }

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setInterval> | null = null;

        async function tick(): Promise<void> {
            if (cancelled) return;
            await pull();
        }

        function start(): void {
            if (timer) return;
            timer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
        }
        function stop(): void {
            if (timer) clearInterval(timer);
            timer = null;
        }
        function onVisibilityChange(): void {
            if (document.visibilityState === 'visible') {
                void tick();
                start();
            } else {
                stop();
            }
        }

        void tick();
        start();
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            cancelled = true;
            stop();
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, []);

    return { events, error, refresh: pull };
}

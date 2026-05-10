import { useEffect, useMemo, useRef, useState } from 'react';
import type {
    DashboardActivityTitleSupportStatus,
    DashboardInstance,
    InstanceLatestMessageSummary,
    ManagerEvent,
} from '../types';

const POLL_INTERVAL_MS = 5_000;
const MAX_MESSAGE_EVENTS = 200;

export type MessageRow = {
    id: number;
    role: string;
    created_at?: string;
    text?: string;
};

export type MessageEnvelope = {
    ok?: boolean;
    data?: MessageRow | InstanceLatestMessageSummary | null;
};

export type InstanceMessageActivityState = {
    events: ManagerEvent[];
    titlesByPort: Record<number, string>;
    titleSupportByPort: Record<number, DashboardActivityTitleSupportStatus>;
    busyPorts: Set<number>;
};

export function latestAssistantFromEnvelope(data: MessageEnvelope['data']): MessageRow | null {
    if (!data) return null;
    if ('latestAssistant' in data) return data.latestAssistant;
    return data.role === 'assistant' && Number.isInteger(data.id) ? data : null;
}

export function notifiableAssistantFromEnvelope(data: MessageEnvelope['data']): MessageRow | null {
    if (!data) return null;
    if ('latestAssistant' in data) {
        const latest = data.latestAssistant;
        const activity = data.activity;
        if (!latest || !activity) return null;
        if (activity.role !== 'assistant') return null;
        if (activity.messageId !== latest.id) return null;
        return latest;
    }
    return data.role === 'assistant' && Number.isInteger(data.id) ? data : null;
}

function activityTitleFromEnvelope(data: MessageEnvelope['data']): string | null {
    if (!data || !('activity' in data)) return null;
    return data.activity?.title || null;
}

function titleSupportFromEnvelope(data: MessageEnvelope['data']): DashboardActivityTitleSupportStatus {
    if (!data) return 'legacy';
    return 'activity' in data || 'latestAssistant' in data ? 'ready' : 'legacy';
}

const BUSY_STALE_MS = 2 * 60 * 60_000;

function parseUtcTimestamp(raw: string): number {
    const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
    return Date.parse(iso.endsWith('Z') ? iso : iso + 'Z');
}

function isActivityBusy(data: MessageEnvelope['data']): boolean {
    if (!data || !('activity' in data)) return false;
    const activity = data.activity;
    if (!activity || activity.role !== 'user') return false;
    const updatedAt = parseUtcTimestamp(activity.updatedAt);
    if (Number.isNaN(updatedAt)) return false;
    return Date.now() - updatedAt < BUSY_STALE_MS;
}

async function fetchLatestAssistantMessage(port: number): Promise<{
    latest: MessageRow | null;
    title: string | null;
    support: DashboardActivityTitleSupportStatus;
    busy: boolean;
}> {
    const response = await fetch(`/i/${port}/api/messages/latest?includeContent=1`);
    if (!response.ok) return { latest: null, title: null, support: 'offline', busy: false };
    const body = await response.json() as MessageEnvelope;
    return {
        latest: notifiableAssistantFromEnvelope(body.data),
        title: activityTitleFromEnvelope(body.data),
        support: titleSupportFromEnvelope(body.data),
        busy: isActivityBusy(body.data),
    };
}

export function useInstanceMessageEvents(instances: DashboardInstance[]): InstanceMessageActivityState {
    const [events, setEvents] = useState<ManagerEvent[]>([]);
    const [titlesByPort, setTitlesByPort] = useState<Record<number, string>>({});
    const [titleSupportByPort, setTitleSupportByPort] = useState<Record<number, DashboardActivityTitleSupportStatus>>({});
    const [busyPorts, setBusyPorts] = useState<Set<number>>(new Set());
    const baselineByPortRef = useRef<Record<number, number>>({});
    const onlinePorts = useMemo(() => {
        return instances.filter(instance => instance.ok).map(instance => instance.port).sort((a, b) => a - b);
    }, [instances]);
    const onlinePortKey = onlinePorts.join(',');
    const instanceSupportKey = useMemo(() => {
        return instances.map(instance => `${instance.port}:${instance.ok ? 'online' : 'offline'}`).sort().join(',');
    }, [instances]);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setInterval> | null = null;

        async function poll(): Promise<void> {
            if (cancelled) return;
            const currentPorts = new Set(instances.map(instance => instance.port));
            const nextSupport: Record<number, DashboardActivityTitleSupportStatus> = {};
            for (const instance of instances) {
                if (!instance.ok) nextSupport[instance.port] = 'offline';
            }
            if (onlinePorts.length === 0) {
                setTitleSupportByPort(nextSupport);
                setTitlesByPort(prev => Object.fromEntries(
                    Object.entries(prev).filter(([port]) => currentPorts.has(Number(port))),
                ));
                return;
            }
            const results = await Promise.allSettled(onlinePorts.map(async (port) => {
                const result = await fetchLatestAssistantMessage(port);
                return { port, ...result };
            }));
            const nextEvents: ManagerEvent[] = [];
            const nextTitles: Record<number, string> = {};
            const nextBusy = new Set<number>();
            for (const result of results) {
                if (result.status !== 'fulfilled') {
                    continue;
                }
                const { port, latest, title, support, busy } = result.value;
                if (busy) nextBusy.add(port);
                nextSupport[port] = support;
                if (title) nextTitles[port] = title;
                if (!latest) continue;
                const previousId = baselineByPortRef.current[port];
                baselineByPortRef.current[port] = latest.id;
                if (previousId == null || latest.id <= previousId) continue;
                nextEvents.push({
                    kind: 'instance-message',
                    port,
                    messageId: latest.id,
                    role: latest.role,
                    at: latest.created_at && !Number.isNaN(Date.parse(latest.created_at))
                        ? latest.created_at
                        : new Date().toISOString(),
                    ...(title ? { title } : {}),
                });
            }
            if (cancelled) return;
            for (const port of onlinePorts) {
                if (!nextSupport[port]) nextSupport[port] = 'offline';
            }
            setTitleSupportByPort(nextSupport);
            setBusyPorts(nextBusy);
            setTitlesByPort(prev => {
                const merged: Record<number, string> = {};
                for (const [portKey, title] of Object.entries(prev)) {
                    const port = Number(portKey);
                    if (currentPorts.has(port) && nextSupport[port] === 'ready') merged[port] = title;
                }
                return { ...merged, ...nextTitles };
            });
            if (nextEvents.length > 0) {
                setEvents(prev => {
                    const merged = [...prev, ...nextEvents];
                    if (merged.length > MAX_MESSAGE_EVENTS) merged.splice(0, merged.length - MAX_MESSAGE_EVENTS);
                    return merged;
                });
            }
        }

        function start(): void {
            if (timer) return;
            timer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
        }

        function stop(): void {
            if (timer) clearInterval(timer);
            timer = null;
        }

        function onVisibilityChange(): void {
            if (document.visibilityState === 'visible') {
                void poll();
                start();
            } else {
                stop();
            }
        }

        void poll();
        start();
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            cancelled = true;
            stop();
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [onlinePortKey, instanceSupportKey]);

    return { events, titlesByPort, titleSupportByPort, busyPorts };
}

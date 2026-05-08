import { useCallback, useEffect, useState } from 'react';
import {
    listReminders,
    refreshReminders,
    type DashboardReminder,
    type DashboardRemindersSourceStatus,
} from './reminders-api';

export type RemindersFeedState = {
    items: DashboardReminder[];
    sourceStatus: DashboardRemindersSourceStatus | null;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
};

type UseRemindersFeedOptions = {
    active: boolean;
};

export function useRemindersFeed(options: UseRemindersFeedOptions): RemindersFeedState {
    const [items, setItems] = useState<DashboardReminder[]>([]);
    const [sourceStatus, setSourceStatus] = useState<DashboardRemindersSourceStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (refresh: boolean): Promise<void> => {
        setLoading(true);
        setError(null);
        try {
            const body = refresh ? await refreshReminders() : await listReminders();
            setItems(body.items || []);
            setSourceStatus(body.sourceStatus ?? null);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    const refresh = useCallback(async (): Promise<void> => {
        await load(true);
    }, [load]);

    useEffect(() => {
        if (!options.active) return;
        void load(true);
    }, [options.active, load]);

    return { items, sourceStatus, loading, error, refresh };
}

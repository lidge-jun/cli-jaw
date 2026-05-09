import { useCallback, useEffect, useState } from 'react';
import {
    createReminder,
    listReminders,
    updateReminder,
    type DashboardReminder,
    type DashboardReminderCreateInput,
    type DashboardReminderPatchInput,
} from './reminders-api';

export type RemindersFeedState = {
    items: DashboardReminder[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    create: (input: DashboardReminderCreateInput) => Promise<void>;
    update: (id: string, patch: DashboardReminderPatchInput) => Promise<void>;
};

type UseRemindersFeedOptions = {
    active: boolean;
};

export function useRemindersFeed(options: UseRemindersFeedOptions): RemindersFeedState {
    const [items, setItems] = useState<DashboardReminder[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError(null);
        try {
            const body = await listReminders();
            setItems(body.items || []);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    const refresh = useCallback(async (): Promise<void> => {
        await load();
    }, [load]);

    const create = useCallback(async (input: DashboardReminderCreateInput): Promise<void> => {
        setError(null);
        try {
            const item = await createReminder(input);
            setItems(current => [item, ...current.filter(existing => existing.id !== item.id)]);
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    const update = useCallback(async (id: string, patch: DashboardReminderPatchInput): Promise<void> => {
        setError(null);
        try {
            const item = await updateReminder(id, patch);
            setItems(current => current.map(existing => existing.id === id ? item : existing));
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    useEffect(() => {
        if (!options.active) return;
        void load();
    }, [options.active, load]);

    return { items, loading, error, refresh, create, update };
}

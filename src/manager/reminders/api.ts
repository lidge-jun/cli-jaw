import { RemindersStore, type DashboardReminder, type DashboardReminderInput, type DashboardReminderPatch } from './store.js';

export type DashboardRemindersFeed = {
    items: DashboardReminder[];
};

export type DashboardRemindersApiOptions = {
    store?: RemindersStore;
};

export function listDashboardReminders(options: DashboardRemindersApiOptions = {}): DashboardRemindersFeed {
    const store = options.store || new RemindersStore();
    return {
        items: store.list(),
    };
}

export function createLocalReminder(input: DashboardReminderInput, options: DashboardRemindersApiOptions = {}): DashboardReminder {
    const store = options.store || new RemindersStore();
    return store.createLocal(input);
}

export function updateLocalReminder(id: string, patch: DashboardReminderPatch, options: DashboardRemindersApiOptions = {}): DashboardReminder | null {
    const store = options.store || new RemindersStore();
    return store.updateLocal(id, patch);
}

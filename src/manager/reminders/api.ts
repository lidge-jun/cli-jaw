import { loadJawRemindersSnapshot } from '../../reminders/jaw-reminders-bridge.js';
import type { JawRemindersBridgeStatus } from '../../reminders/types.js';
import { RemindersStore, type DashboardReminder, type DashboardReminderInput, type DashboardReminderPatch } from './store.js';

export type DashboardRemindersSourceStatus =
    | {
        ok: true;
        sourcePath: string;
        loadedAt: string;
        schemaVersion: number;
        lists: number;
        reminders: number;
        mirrored: number;
    }
    | {
        ok: false;
        code: Exclude<JawRemindersBridgeStatus, { ok: true }>['code'];
        message: string;
        sourcePath: string;
        loadedAt: string;
    };

export type DashboardRemindersFeed = {
    items: DashboardReminder[];
    sourceStatus: DashboardRemindersSourceStatus | null;
};

export type DashboardRemindersApiOptions = {
    store?: RemindersStore;
    sourcePath?: string;
};

function toSourceStatus(status: JawRemindersBridgeStatus, mirrored = 0): DashboardRemindersSourceStatus {
    if (!status.ok) {
        return {
            ok: false,
            code: status.code,
            message: status.message,
            sourcePath: status.sourcePath,
            loadedAt: status.loadedAt,
        };
    }
    return {
        ok: true,
        sourcePath: status.sourcePath,
        loadedAt: status.loadedAt,
        schemaVersion: status.snapshot.schemaVersion,
        lists: status.snapshot.lists.length,
        reminders: status.snapshot.reminders.length,
        mirrored,
    };
}

function bridgeOptions(sourcePath: string | undefined): { sourcePath?: string } {
    return sourcePath ? { sourcePath } : {};
}

export function listDashboardReminders(options: DashboardRemindersApiOptions = {}): DashboardRemindersFeed {
    const store = options.store || new RemindersStore();
    return {
        items: store.list(),
        sourceStatus: null,
    };
}

export async function refreshDashboardReminders(
    options: DashboardRemindersApiOptions = {},
): Promise<DashboardRemindersFeed> {
    const store = options.store || new RemindersStore();
    const status = await loadJawRemindersSnapshot(bridgeOptions(options.sourcePath));
    if (!status.ok) {
        return {
            items: store.list(),
            sourceStatus: toSourceStatus(status),
        };
    }
    const mirrored = store.upsertFromSnapshot(status.snapshot, status.loadedAt);
    return {
        items: store.list(),
        sourceStatus: toSourceStatus(status, mirrored),
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

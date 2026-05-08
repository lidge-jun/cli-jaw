export type DashboardReminderStatus = 'open' | 'focused' | 'waiting' | 'done';
export type DashboardReminderPriority = 'low' | 'normal' | 'high';
export type DashboardReminderNotificationStatus =
    | 'pending'
    | 'delivered'
    | 'no_channel'
    | 'failed'
    | 'invalid_remind_at';

export type DashboardReminder = {
    id: string;
    title: string;
    notes: string;
    listId: string;
    status: DashboardReminderStatus;
    priority: DashboardReminderPriority;
    dueAt: string | null;
    remindAt: string | null;
    linkedInstance: string | null;
    subtasks: Array<{ id: string; title: string; done: boolean }>;
    source: 'jaw-reminders' | 'cli-jaw-local';
    sourceCreatedAt: string;
    sourceUpdatedAt: string;
    mirroredAt: string;
    notificationStatus: DashboardReminderNotificationStatus;
    notificationAttemptedAt: string | null;
    notificationError: string | null;
    instanceId: string | null;
    messageId: string | null;
    turnIndex: number | null;
    port: number | null;
    threadKey: string | null;
    sourceText: string | null;
};

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
        code: 'missing_file' | 'invalid_json' | 'schema_mismatch' | 'read_failed' | 'platform_unsupported';
        message: string;
        sourcePath: string;
        loadedAt: string;
    };

export type DashboardRemindersResponse = {
    ok: boolean;
    items?: DashboardReminder[];
    sourceStatus?: DashboardRemindersSourceStatus | null;
};

const BASE = '/api/dashboard/reminders';

async function asJson<T>(res: Response): Promise<T> {
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`${res.status} ${body || res.statusText}`);
    }
    return await res.json() as T;
}

function normalizeReminder(item: DashboardReminder): DashboardReminder {
    return {
        ...item,
        notes: item.notes ?? '',
        dueAt: item.dueAt ?? null,
        remindAt: item.remindAt ?? null,
        linkedInstance: item.linkedInstance ?? null,
        subtasks: Array.isArray(item.subtasks) ? item.subtasks : [],
        notificationAttemptedAt: item.notificationAttemptedAt ?? null,
        notificationError: item.notificationError ?? null,
        instanceId: item.instanceId ?? null,
        messageId: item.messageId ?? null,
        turnIndex: item.turnIndex ?? null,
        port: item.port ?? null,
        threadKey: item.threadKey ?? null,
        sourceText: item.sourceText ?? null,
    };
}

export async function listReminders(options: { refresh?: boolean } = {}): Promise<DashboardRemindersResponse> {
    const suffix = options.refresh ? '?refresh=1' : '';
    const res = await fetch(`${BASE}${suffix}`, { credentials: 'same-origin', cache: 'no-store' });
    const body = await asJson<DashboardRemindersResponse>(res);
    return {
        ...body,
        items: Array.isArray(body.items) ? body.items.map(normalizeReminder) : [],
        sourceStatus: body.sourceStatus ?? null,
    };
}

export async function refreshReminders(): Promise<DashboardRemindersResponse> {
    const res = await fetch(`${BASE}/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
    });
    const body = await asJson<DashboardRemindersResponse>(res);
    return {
        ...body,
        items: Array.isArray(body.items) ? body.items.map(normalizeReminder) : [],
        sourceStatus: body.sourceStatus ?? null,
    };
}

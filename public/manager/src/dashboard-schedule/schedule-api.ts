export type DashboardScheduleGroup = 'today' | 'upcoming' | 'recurring' | 'blocked';

export type DashboardScheduledWork = {
    id: string;
    title: string;
    group: DashboardScheduleGroup;
    cron: string | null;
    runAt: string | null;
    targetPort: number | null;
    payload: string | null;
    enabled: boolean;
    lastRunAt: string | null;
    lastStatus: string | null;
    nextRunAt: string | null;
    createdAt: string;
    updatedAt: string;
};

export type DashboardScheduledWorkInput = {
    title: string;
    group?: DashboardScheduleGroup;
    cron?: string | null;
    runAt?: string | null;
    targetPort?: number | null;
    payload?: string | null;
    enabled?: boolean;
};

export type DashboardScheduledWorkPatch = Partial<DashboardScheduledWorkInput>;

const BASE = '/api/dashboard/schedule';

async function asJson<T>(res: Response): Promise<T> {
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`${res.status} ${body || res.statusText}`);
    }
    return await res.json() as T;
}

export async function listScheduled(): Promise<DashboardScheduledWork[]> {
    const res = await fetch(`${BASE}/work`, { credentials: 'same-origin' });
    const body = await asJson<{ ok: boolean; items?: DashboardScheduledWork[] }>(res);
    return Array.isArray(body.items) ? body.items : [];
}

export async function createScheduled(input: DashboardScheduledWorkInput): Promise<DashboardScheduledWork> {
    const res = await fetch(`${BASE}/work`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(input),
    });
    const body = await asJson<{ ok: boolean; item: DashboardScheduledWork }>(res);
    return body.item;
}

export async function updateScheduled(id: string, patch: DashboardScheduledWorkPatch): Promise<DashboardScheduledWork> {
    const res = await fetch(`${BASE}/work/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(patch),
    });
    const body = await asJson<{ ok: boolean; item: DashboardScheduledWork }>(res);
    return body.item;
}

export async function deleteScheduled(id: string): Promise<void> {
    const res = await fetch(`${BASE}/work/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
    });
    await asJson<{ ok: boolean }>(res);
}

export type DispatchStatus = 'queued' | 'dispatched' | 'no_target' | 'disabled';

export type DispatchResult = {
    status: DispatchStatus;
    message: string;
    targetPort: number | null;
};

export type DispatchResponse = {
    result: DispatchResult;
    item: DashboardScheduledWork;
};

export async function dispatchScheduled(id: string, busyPorts: number[] = []): Promise<DispatchResponse> {
    const res = await fetch(`${BASE}/work/${encodeURIComponent(id)}/dispatch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ busyPorts }),
    });
    const body = await asJson<{ ok: boolean; result: DispatchResult; item: DashboardScheduledWork }>(res);
    return { result: body.result, item: body.item };
}

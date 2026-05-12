import type {
    DashboardWorkspaceEvent,
    DashboardWorkspaceItem,
    DashboardWorkspaceItemInput,
    DashboardWorkspaceItemPatch,
    DashboardWorkspaceMoveInput,
    DashboardWorkspaceSnapshot,
    WorkspaceInstanceLink,
} from './workspace-types';

const BASE = '/api/dashboard/workspace';

async function asJson<T>(res: Response): Promise<T> {
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`${res.status} ${body || res.statusText}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        throw new Error('Workspace API is not available in the running dashboard server. Rebuild and restart the dashboard backend to enable workspace features.');
    }
    return await res.json() as T;
}

function normalizeLink(link: WorkspaceInstanceLink): WorkspaceInstanceLink {
    return {
        instanceId: link.instanceId ?? null,
        port: typeof link.port === 'number' && Number.isInteger(link.port) ? link.port : null,
        messageId: link.messageId ?? null,
        turnIndex: typeof link.turnIndex === 'number' && Number.isInteger(link.turnIndex) ? link.turnIndex : null,
        threadKey: link.threadKey ?? null,
    };
}

export function normalizeWorkspaceItem(item: DashboardWorkspaceItem): DashboardWorkspaceItem {
    return {
        ...item,
        body: item.body ?? '',
        dueAt: item.dueAt ?? null,
        remindAt: item.remindAt ?? null,
        notePaths: Array.isArray(item.notePaths) ? item.notePaths : [],
        instanceLinks: Array.isArray(item.instanceLinks) ? item.instanceLinks.map(normalizeLink) : [],
    };
}

function normalizeSnapshot(snapshot: DashboardWorkspaceSnapshot): DashboardWorkspaceSnapshot {
    const items = Array.isArray(snapshot.items) ? snapshot.items.map(normalizeWorkspaceItem) : [];
    return {
        items,
        board: snapshot.board ?? {},
        matrix: snapshot.matrix ?? {
            urgentImportant: [],
            important: [],
            waiting: [],
            later: [],
        },
        events: Array.isArray(snapshot.events) ? snapshot.events : [],
    };
}

export async function getWorkspaceSnapshot(): Promise<DashboardWorkspaceSnapshot> {
    const res = await fetch(`${BASE}/snapshot`, { credentials: 'same-origin', cache: 'no-store' });
    const body = await asJson<{ ok: boolean } & DashboardWorkspaceSnapshot>(res);
    return normalizeSnapshot(body);
}

export async function listWorkspaceItems(): Promise<DashboardWorkspaceItem[]> {
    const res = await fetch(`${BASE}/items`, { credentials: 'same-origin', cache: 'no-store' });
    const body = await asJson<{ ok: boolean; items?: DashboardWorkspaceItem[] }>(res);
    return Array.isArray(body.items) ? body.items.map(normalizeWorkspaceItem) : [];
}

export async function createWorkspaceItem(input: DashboardWorkspaceItemInput): Promise<DashboardWorkspaceItem> {
    const res = await fetch(`${BASE}/items`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
    });
    const body = await asJson<{ ok: boolean; item: DashboardWorkspaceItem }>(res);
    return normalizeWorkspaceItem(body.item);
}

export async function updateWorkspaceItem(id: string, patch: DashboardWorkspaceItemPatch): Promise<DashboardWorkspaceItem> {
    const res = await fetch(`${BASE}/items/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
    });
    const body = await asJson<{ ok: boolean; item: DashboardWorkspaceItem }>(res);
    return normalizeWorkspaceItem(body.item);
}

export async function moveWorkspaceItem(id: string, input: DashboardWorkspaceMoveInput): Promise<DashboardWorkspaceItem> {
    const res = await fetch(`${BASE}/items/${encodeURIComponent(id)}/move`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
    });
    const body = await asJson<{ ok: boolean; item: DashboardWorkspaceItem }>(res);
    return normalizeWorkspaceItem(body.item);
}

export async function linkWorkspaceNote(id: string, path: string, revision?: number, actor = 'agent'): Promise<DashboardWorkspaceItem> {
    const payload: { path: string; revision?: number; actor: string } = { path, actor };
    if (revision !== undefined) payload.revision = revision;
    const res = await fetch(`${BASE}/items/${encodeURIComponent(id)}/link-note`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = await asJson<{ ok: boolean; item: DashboardWorkspaceItem }>(res);
    return normalizeWorkspaceItem(body.item);
}

export async function linkWorkspaceInstance(id: string, link: WorkspaceInstanceLink, revision?: number, actor = 'agent'): Promise<DashboardWorkspaceItem> {
    const payload: { link: WorkspaceInstanceLink; revision?: number; actor: string } = { link, actor };
    if (revision !== undefined) payload.revision = revision;
    const res = await fetch(`${BASE}/items/${encodeURIComponent(id)}/link-instance`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const body = await asJson<{ ok: boolean; item: DashboardWorkspaceItem }>(res);
    return normalizeWorkspaceItem(body.item);
}

export async function listWorkspaceEvents(limit = 50): Promise<DashboardWorkspaceEvent[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    const res = await fetch(`${BASE}/events?${params.toString()}`, { credentials: 'same-origin', cache: 'no-store' });
    const body = await asJson<{ ok: boolean; events?: DashboardWorkspaceEvent[] }>(res);
    return Array.isArray(body.events) ? body.events : [];
}

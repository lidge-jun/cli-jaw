import { DASHBOARD_DEFAULT_PORT } from '../manager/constants.js';

function baseUrl(): string {
    const port = process.env["DASHBOARD_PORT"] || DASHBOARD_DEFAULT_PORT;
    return `http://localhost:${port}`;
}

export type ConnectorCliResult =
    | { ok: true; action: string; data: unknown }
    | { ok: false; code: string; error: string };

export type BoardAddOpts = { title: string; summary?: string | undefined; lane?: string | undefined };
export type BoardUpdateOpts = { title?: string | undefined; summary?: string | undefined; lane?: string | undefined };
export type NotesWriteOpts = { path: string; body: string };

async function request(method: string, path: string, body?: unknown): Promise<ConnectorCliResult> {
    try {
        const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) init.body = JSON.stringify(body);
        const res = await fetch(`${baseUrl()}${path}`, init);
        const json = await res.json() as Record<string, unknown>;
        if (json["ok"] === true) {
            return { ok: true, action: method, data: json };
        }
        return {
            ok: false,
            code: String(json["code"] || 'unknown'),
            error: String(json["error"] || `HTTP ${res.status}`),
        };
    } catch (e) {
        return {
            ok: false,
            code: 'connector_fetch_failed',
            error: (e as Error).message,
        };
    }
}

export async function connectorBoardAdd(opts: BoardAddOpts): Promise<ConnectorCliResult> {
    return request('POST', '/api/dashboard/connector/board', {
        title: opts.title,
        summary: opts.summary ?? null,
        lane: opts.lane ?? 'backlog',
        userRequested: true,
    });
}

export async function connectorBoardUpdate(id: string, opts: BoardUpdateOpts): Promise<ConnectorCliResult> {
    return request('PATCH', `/api/dashboard/connector/board/${id}`, {
        ...opts,
        userRequested: true,
    });
}

export async function connectorBoardList(): Promise<ConnectorCliResult> {
    return request('GET', '/api/dashboard/board/tasks');
}

export async function connectorNotesWrite(opts: NotesWriteOpts): Promise<ConnectorCliResult> {
    return request('POST', '/api/dashboard/connector/notes', {
        path: opts.path,
        body: opts.body,
        userRequested: true,
    });
}

export async function connectorNotesList(): Promise<ConnectorCliResult> {
    return request('GET', '/api/dashboard/notes/tree');
}

export async function connectorAudit(limit = 50): Promise<ConnectorCliResult> {
    return request('GET', `/api/dashboard/connector/audit?limit=${limit}`);
}

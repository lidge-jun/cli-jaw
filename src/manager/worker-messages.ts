export type WorkerMessageRow = {
    id: number;
    role: string;
    content: string;
    created_at?: string;
};

type WorkerFetchResponse = {
    ok: boolean;
    json: () => Promise<unknown>;
};

type WorkerFetch = (url: string) => Promise<WorkerFetchResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isInteger(parsed)) return parsed;
    }
    return null;
}

export function extractWorkerMessageRows(body: unknown): WorkerMessageRow[] {
    const rawRows = isRecord(body) && Array.isArray(body['data'])
        ? body['data']
        : Array.isArray(body)
            ? body
            : [];
    const rows: WorkerMessageRow[] = [];
    for (const raw of rawRows) {
        if (!isRecord(raw)) continue;
        const id = numberValue(raw['id']);
        const role = stringValue(raw['role']);
        if (id == null || !role) continue;
        const row: WorkerMessageRow = {
            id,
            role,
            content: stringValue(raw['content']) || '',
        };
        const createdAt = stringValue(raw['created_at']);
        if (createdAt) row.created_at = createdAt;
        rows.push(row);
    }
    return rows;
}

export function findWorkerAssistantText(rows: WorkerMessageRow[], messageId: number): string {
    const match = rows.find(row => row.id === messageId && row.role === 'assistant');
    const text = match?.content || '';
    return text.trim() ? text : '';
}

export async function fetchWorkerMessageRows(fetchImpl: WorkerFetch, port: number): Promise<WorkerMessageRow[]> {
    const response = await fetchImpl(`http://127.0.0.1:${port}/api/messages`);
    if (!response.ok) return [];
    return extractWorkerMessageRows(await response.json());
}

export async function fetchWorkerAssistantTextById(fetchImpl: WorkerFetch, port: number, messageId: number): Promise<string> {
    if (!Number.isInteger(messageId)) return '';
    const rows = await fetchWorkerMessageRows(fetchImpl, port);
    return findWorkerAssistantText(rows, messageId);
}

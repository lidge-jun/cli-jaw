export interface EmployeeSummary {
    id?: string;
    name?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isEmployeeSummary(value: unknown): value is EmployeeSummary {
    if (!isRecord(value)) return false;
    return typeof value['id'] === 'string' || typeof value['name'] === 'string';
}

export function unwrapEmployeeSummaries(body: unknown): EmployeeSummary[] {
    if (Array.isArray(body)) return body.filter(isEmployeeSummary);
    if (isRecord(body) && Array.isArray(body['data'])) {
        return body['data'].filter(isEmployeeSummary);
    }
    return [];
}

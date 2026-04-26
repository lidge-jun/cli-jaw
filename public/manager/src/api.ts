import type { DashboardLifecycleAction, DashboardLifecycleResult, DashboardScanResult } from './types';

export async function fetchInstances(): Promise<DashboardScanResult> {
    const response = await fetch('/api/dashboard/instances');
    if (!response.ok) throw new Error(`scan failed: ${response.status}`);
    return await response.json() as DashboardScanResult;
}

export async function runLifecycleAction(
    action: DashboardLifecycleAction,
    port: number,
    home?: string,
): Promise<DashboardLifecycleResult> {
    const response = await fetch(`/api/dashboard/lifecycle/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ port, ...(home?.trim() ? { home: home.trim() } : {}) }),
    });
    const result = await response.json() as DashboardLifecycleResult;
    if (!response.ok || !result.ok) {
        throw new Error(result.message || `${action} failed: ${response.status}`);
    }
    return result;
}

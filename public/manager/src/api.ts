import type {
    DashboardLifecycleAction,
    DashboardLifecycleResult,
    DashboardRegistryLoadResult,
    DashboardRegistryPatch,
    DashboardScanResult,
} from './types';

export async function fetchInstances(showHidden = false): Promise<DashboardScanResult> {
    const path = showHidden ? '/api/dashboard/instances?showHidden=1' : '/api/dashboard/instances';
    const response = await fetch(path);
    if (!response.ok) throw new Error(`scan failed: ${response.status}`);
    return await response.json() as DashboardScanResult;
}

export async function fetchRegistry(): Promise<DashboardRegistryLoadResult> {
    const response = await fetch('/api/dashboard/registry');
    if (!response.ok) throw new Error(`registry load failed: ${response.status}`);
    return await response.json() as DashboardRegistryLoadResult;
}

export async function patchDashboardRegistry(patch: DashboardRegistryPatch): Promise<DashboardRegistryLoadResult> {
    const response = await fetch('/api/dashboard/registry', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error(`registry save failed: ${response.status}`);
    return await response.json() as DashboardRegistryLoadResult;
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

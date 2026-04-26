import type { DashboardScanResult } from './types';

export async function fetchInstances(): Promise<DashboardScanResult> {
    const response = await fetch('/api/dashboard/instances');
    if (!response.ok) throw new Error(`scan failed: ${response.status}`);
    return await response.json() as DashboardScanResult;
}


import type { DashboardSidebarMode } from './types';

const SIDEBAR_MODES = new Set<DashboardSidebarMode>([
    'instances',
    'board',
    'schedule',
    'reminders',
    'notes',
    'settings',
]);

export function readInitialSidebarMode(search: string): DashboardSidebarMode | null {
    const mode = new URLSearchParams(search).get('sidebar');
    return SIDEBAR_MODES.has(mode as DashboardSidebarMode) ? mode as DashboardSidebarMode : null;
}

import type { DashboardSidebarMode } from './types';

export const NPM_HIDDEN_WORKSPACE_MODES = new Set<DashboardSidebarMode>(['schedule']);

export const SCHEDULE_WORKSPACE_ENABLED =
    import.meta.env.DEV || import.meta.env['VITE_CLI_JAW_EXPERIMENTAL_DASHBOARD'] === '1';

export const REMINDERS_WORKSPACE_ENABLED = true;

export function isNpmHiddenWorkspaceMode(mode: DashboardSidebarMode): boolean {
    return NPM_HIDDEN_WORKSPACE_MODES.has(mode);
}

export function normalizeSidebarModeForBuild(mode: DashboardSidebarMode): DashboardSidebarMode {
    if (mode === 'schedule' && SCHEDULE_WORKSPACE_ENABLED) return mode;
    if (mode === 'reminders' && REMINDERS_WORKSPACE_ENABLED) return mode;
    return isNpmHiddenWorkspaceMode(mode) ? 'instances' : mode;
}

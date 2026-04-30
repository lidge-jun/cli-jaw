import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const DASHBOARD_HOME_ENV = 'CLI_JAW_DASHBOARD_HOME';
export const DEFAULT_DASHBOARD_HOME_BASENAME = '.cli-jaw-dashboard';

function expandHomePath(value: string): string {
    return value.replace(/^~(?=\/|$)/, homedir());
}

export function resolveDashboardHome(env: NodeJS.ProcessEnv = process.env): string {
    const raw = env[DASHBOARD_HOME_ENV]?.trim() || join(homedir(), DEFAULT_DASHBOARD_HOME_BASENAME);
    return resolve(expandHomePath(raw));
}

function resolveDashboardPath(parts: string[], env: NodeJS.ProcessEnv = process.env): string {
    return join(resolveDashboardHome(env), ...parts);
}

export function dashboardPath(...parts: string[]): string {
    return resolveDashboardPath(parts);
}

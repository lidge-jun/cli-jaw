import type { DashboardActivityTitleSupportStatus } from '../types';

export type DashboardActivityTitleSupport = {
    ready: number;
    legacy: number;
    offline: number;
    byPort: Record<number, DashboardActivityTitleSupportStatus>;
};

export function summarizeActivityTitleSupport(
    supportByPort: Record<number, DashboardActivityTitleSupportStatus>,
): DashboardActivityTitleSupport {
    const summary: DashboardActivityTitleSupport = {
        ready: 0,
        legacy: 0,
        offline: 0,
        byPort: supportByPort,
    };
    for (const status of Object.values(supportByPort)) {
        summary[status] += 1;
    }
    return summary;
}

import type { DashboardScheduledWork } from './store.js';

export type DispatchStatus = 'queued' | 'dispatched' | 'no_target' | 'disabled';

export type DispatchResult = {
    status: DispatchStatus;
    message: string;
    targetPort: number | null;
};

export type DispatchOptions = {
    busyPorts?: readonly number[];
};

/**
 * Decide whether a scheduled work item can be dispatched to its target instance.
 * Pure function — no I/O. The caller (route layer) is responsible for executing
 * the actual message send and updating the item's state.
 */
export function dispatchScheduledWork(
    item: DashboardScheduledWork,
    opts: DispatchOptions = {},
): DispatchResult {
    if (!item.enabled) {
        return { status: 'disabled', message: 'item is disabled', targetPort: item.targetPort };
    }
    if (item.targetPort == null) {
        return { status: 'no_target', message: 'no target port', targetPort: null };
    }
    const busy = opts.busyPorts ?? [];
    if (busy.includes(item.targetPort)) {
        return {
            status: 'queued',
            message: `port ${item.targetPort} busy — keeping in queue`,
            targetPort: item.targetPort,
        };
    }
    return {
        status: 'dispatched',
        message: `ready to deliver to :${item.targetPort}`,
        targetPort: item.targetPort,
    };
}

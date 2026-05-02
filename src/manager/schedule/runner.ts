import { matchesHeartbeatCron } from '../../memory/heartbeat-schedule.js';
import { dispatchScheduledWork } from './dispatcher.js';
import type { ScheduleStore, DashboardScheduledWork } from './store.js';

export type ScheduleRunnerOptions = {
    intervalMs?: number;
    log?: (msg: string) => void;
};

/**
 * Manager-level scheduler tick. Single ticker for the whole dashboard.
 *
 * Replaces per-instance heartbeat loops as the source of truth for recurring
 * dashboard work. We DO NOT call `claimForDispatch` here — that mutates
 * `enabled=0` and would kill recurring rows on first fire. Instead we record
 * the run via `markRun` and let the row remain active.
 */
export function startScheduleRunner(
    store: ScheduleStore,
    opts: ScheduleRunnerOptions = {},
): () => void {
    const intervalMs = opts.intervalMs ?? 60_000;
    const log = opts.log ?? (() => {});
    const minuteFiredKeys = new Set<string>();

    function shouldFire(item: DashboardScheduledWork, now: Date): boolean {
        if (!item.enabled) return false;
        if (item.cron) {
            if (!matchesHeartbeatCron(item.cron, now)) return false;
            const slot = `${item.id}:${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`;
            if (minuteFiredKeys.has(slot)) return false;
            minuteFiredKeys.add(slot);
            // Trim the dedup set so it doesn't grow unbounded.
            if (minuteFiredKeys.size > 4096) {
                const first = minuteFiredKeys.values().next().value;
                if (first) minuteFiredKeys.delete(first);
            }
            return true;
        }
        if (item.runAt) {
            const due = Date.parse(item.runAt);
            if (Number.isNaN(due)) return false;
            if (due > now.getTime()) return false;
            return !item.lastRunAt || Date.parse(item.lastRunAt) < due;
        }
        return false;
    }

    function tick(): void {
        const now = new Date();
        let items: DashboardScheduledWork[];
        try {
            items = store.list().filter(it => it.enabled);
        } catch (err) {
            log(`[schedule-runner] list failed: ${(err as Error).message}`);
            return;
        }
        for (const item of items) {
            if (!shouldFire(item, now)) continue;
            const decision = dispatchScheduledWork(item, { busyPorts: [] });
            try {
                store.markRun(item.id, `runner:${decision.status}`, null);
            } catch (err) {
                log(`[schedule-runner] markRun failed for ${item.id}: ${(err as Error).message}`);
            }
            log(`[schedule-runner] ${item.id} → ${decision.status}: ${decision.message}`);
        }
    }

    // Kick off on next minute boundary so cron alignment is predictable.
    const handle = setInterval(tick, intervalMs);
    if (typeof handle.unref === 'function') handle.unref();
    return () => clearInterval(handle);
}

// ─── Heartbeat run record ────────────────────────────
// What one tick actually did, kept apart from whether it was delivered.
//
// The heartbeat had exactly one durable trace of a tick: `insertHeartbeatAnchor`,
// written only when a send succeeded. Every other outcome — a held destination, an
// unreservable grant, a refused mention watch, a thrown runner — produced a log
// line and nothing else, so a job that failed on every tick for a week was
// indistinguishable from a job that had nothing to say.
//
// The split below is borrowed from openclaw's cron, which separates execution
// status from delivery status precisely because 'the model finished' and 'the
// recipient got it' are different claims and conflating them makes a green run
// meaningless as evidence.

export type HeartbeatExecution = 'ok' | 'error' | 'skipped';
export type HeartbeatDelivery = 'delivered' | 'not_delivered' | 'suppressed' | 'not_requested';

/** What a tick did. `reason` is operator-facing and never carries a token or
 *  report body. */
export type HeartbeatRunOutcome = {
    execution: HeartbeatExecution;
    delivery: HeartbeatDelivery;
    reason?: string;
};

export type HeartbeatRunRecord = HeartbeatRunOutcome & {
    jobId: string;
    startedAt: number;
    finishedAt: number;
    /** True when the schedule was torn down under this run. Its outcome is still
     *  true and worth recording, but it describes a configuration that no longer
     *  exists, so it must not move the counters. */
    superseded: boolean;
    consecutiveFailures: number;
    consecutiveSkips: number;
};

/** Ticks in a row before a job is called failing.
 *
 *  openclaw auto-disables at ten, but its jobs also carry exponential backoff. This
 *  scheduler has none, so a five-minute job reaches five in twenty-five minutes, and
 *  twenty-five minutes of silent failure is already longer than a heartbeat is useful
 *  for. Nothing is disabled at the threshold — the job keeps its timer, exactly as a
 *  live destination hold does, because silently stopping a job is the failure #745
 *  was about. It becomes VISIBLE. */
export const HEARTBEAT_FAILURE_HOLD_THRESHOLD = 5;

/** Fold one tick's outcome into the running record.
 *
 *  Three rules, each of which exists because collapsing it produced a wrong answer:
 *
 *  - A delivery failure does NOT increment the failure streak. The work succeeded;
 *    the transport did not. Counting it as an execution failure makes a flaky
 *    channel look like a broken job.
 *  - A skip gets its OWN counter rather than being ignored. A job that refuses every
 *    tick — an unverifiable workspace, a grant that never reserves — would otherwise
 *    sit at zero forever and never become visible, which is the same invisibility
 *    this record exists to end.
 *  - A superseded run carries both counters through untouched. Letting a late `ok`
 *    reset a streak, or a post-abort throw increment one, describes a schedule the
 *    operator already replaced. */
export function foldRunRecord(
    previous: HeartbeatRunRecord | undefined,
    next: Omit<HeartbeatRunRecord, 'consecutiveFailures' | 'consecutiveSkips'>,
): HeartbeatRunRecord {
    const failures = previous?.consecutiveFailures ?? 0;
    const skips = previous?.consecutiveSkips ?? 0;
    if (next.superseded) return { ...next, consecutiveFailures: failures, consecutiveSkips: skips };
    if (next.execution === 'error') return { ...next, consecutiveFailures: failures + 1, consecutiveSkips: skips };
    if (next.execution === 'skipped') return { ...next, consecutiveFailures: failures, consecutiveSkips: skips + 1 };
    return { ...next, consecutiveFailures: 0, consecutiveSkips: 0 };
}

/** Either counter at the threshold. A skip and a crash need different operator
 *  responses, which is why they are counted apart — but neither may be invisible. */
export function isHeartbeatJobFailing(record: HeartbeatRunRecord | undefined): boolean {
    if (!record) return false;
    return record.consecutiveFailures >= HEARTBEAT_FAILURE_HOLD_THRESHOLD
        || record.consecutiveSkips >= HEARTBEAT_FAILURE_HOLD_THRESHOLD;
}

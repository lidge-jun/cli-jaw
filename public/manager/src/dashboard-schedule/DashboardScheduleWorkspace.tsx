import { useCallback, useEffect, useRef, useState } from 'react';
import { SCHEDULE_GROUPS, type ScheduleGroup } from './DashboardScheduleSidebar';
import {
    listScheduled,
    createScheduled,
    updateScheduled,
    deleteScheduled,
    dispatchScheduled,
    type DashboardScheduledWork,
    type DispatchResult,
} from './schedule-api';
import { HelpTopicButton } from '../help/HelpTopicButton';
import type { HelpTopicId } from '../help/helpContent';

type HeartbeatJob = {
    id: string;
    name: string;
    enabled: boolean;
    schedule?: { kind: string; minutes?: number; cron?: string; timeZone?: string };
};

type Props = {
    active: boolean;
    activeGroup: ScheduleGroup;
    busyPorts?: ReadonlySet<number> | number[];
    onOpenHelpTopic: (topic: HelpTopicId) => void;
};

async function fetchHeartbeatJobs(): Promise<HeartbeatJob[]> {
    try {
        const res = await fetch('/api/heartbeat', { credentials: 'same-origin' });
        if (!res.ok) return [];
        const body = await res.json() as { jobs?: HeartbeatJob[] };
        return Array.isArray(body.jobs) ? body.jobs : [];
    } catch {
        return [];
    }
}

function jobGroup(job: HeartbeatJob): ScheduleGroup {
    if (!job.enabled) return 'blocked';
    if (job.schedule?.kind === 'every') return 'recurring';
    if (job.schedule?.kind === 'cron') return 'recurring';
    return 'upcoming';
}
// jobGroup retained for legacy heartbeat counting only — display moved out.
void jobGroup;

function describeJob(job: HeartbeatJob): string {
    const s = job.schedule;
    if (!s) return '—';
    if (s.kind === 'every' && typeof s.minutes === 'number') return `every ${s.minutes}m`;
    if (s.kind === 'cron' && s.cron) return `cron ${s.cron}${s.timeZone ? ` (${s.timeZone})` : ''}`;
    return s.kind;
}
void describeJob;

function describeWork(item: DashboardScheduledWork): string {
    if (item.cron) return `cron ${item.cron}`;
    if (item.runAt) return `at ${item.runAt}`;
    return item.enabled ? 'manual' : 'disabled';
}

export function DashboardScheduleWorkspace(props: Props) {
    const [jobs, setJobs] = useState<HeartbeatJob[]>([]);
    const [items, setItems] = useState<DashboardScheduledWork[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [composerGroup, setComposerGroup] = useState<ScheduleGroup | null>(null);
    const [composerTitle, setComposerTitle] = useState('');
    const [busy, setBusy] = useState(false);
    const [dispatchByItem, setDispatchByItem] = useState<Record<string, DispatchResult>>({});
    const [movePopoverFor, setMovePopoverFor] = useState<string | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);

    const reload = useCallback(async () => {
        try { setItems(await listScheduled()); }
        catch { /* ignore */ }
    }, []);

    useEffect(() => {
        if (!props.active) return;
        let cancelled = false;
        void Promise.all([fetchHeartbeatJobs(), listScheduled().catch(() => [] as DashboardScheduledWork[])])
            .then(([j, sw]) => {
                if (cancelled) return;
                setJobs(j);
                setItems(sw);
                setLoaded(true);
            });
        return () => { cancelled = true; };
    }, [props.active]);

    useEffect(() => {
        if (!movePopoverFor) return;
        const handler = (e: MouseEvent) => {
            if (!popoverRef.current) return;
            if (!popoverRef.current.contains(e.target as Node)) setMovePopoverFor(null);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [movePopoverFor]);

    const onAdd = useCallback(async (group: ScheduleGroup) => {
        const title = composerTitle.trim();
        if (!title || busy) return;
        setBusy(true);
        try {
            await createScheduled({ title, group });
            setComposerTitle('');
            setComposerGroup(null);
            await reload();
        } catch { /* ignore */ }
        finally { setBusy(false); }
    }, [composerTitle, busy, reload]);

    const onMove = useCallback(async (id: string, group: ScheduleGroup) => {
        setMovePopoverFor(null);
        try { await updateScheduled(id, { group }); await reload(); }
        catch { /* ignore */ }
    }, [reload]);

    const onDelete = useCallback(async (id: string) => {
        try { await deleteScheduled(id); await reload(); }
        catch { /* ignore */ }
    }, [reload]);

    const onDispatch = useCallback(async (id: string) => {
        try {
            const bp = props.busyPorts;
            const arr = Array.isArray(bp) ? bp : bp ? Array.from(bp) : [];
            const { result } = await dispatchScheduled(id, arr);
            setDispatchByItem(prev => ({ ...prev, [id]: result }));
            await reload();
        } catch { /* ignore */ }
    }, [props.busyPorts, reload]);

    return (
        <section className="dashboard-schedule-workspace" aria-hidden={!props.active}>
            <header className="dashboard-schedule-workspace-header">
                <div>
                    <h2>Automations</h2>
                    <p className="dashboard-schedule-workspace-subtitle">
                        Manager-owned scheduled work. The dashboard ticks once a minute and dispatches due items.
                    </p>
                </div>
                <HelpTopicButton topic="schedule" label="Open Automations help" onOpen={props.onOpenHelpTopic} />
                {jobs.length > 0 ? (
                    <p className="dashboard-schedule-legacy-notice" role="note">
                        ⚠️ {jobs.length} legacy heartbeat job(s) detected in this instance's <code>heartbeat.json</code>. They are
                        no longer auto-fired by the manager — migrate them into Automations.
                    </p>
                ) : null}
            </header>
            <div className="dashboard-schedule-groups">
                {SCHEDULE_GROUPS.map(group => {
                    const allItems = items.filter(item => item.group === group.id);
                    // Hide disabled persisted items by default — only show enabled ones.
                    const groupItems = allItems.filter(item => item.enabled);
                    const total = groupItems.length;
                    const isComposing = composerGroup === group.id;
                    return (
                        <div
                            key={group.id}
                            className={`dashboard-schedule-group${props.activeGroup === group.id ? ' is-focused' : ''}`}
                        >
                            <header className="dashboard-schedule-group-header">
                                <span className="dashboard-schedule-group-title">{group.label}</span>
                                <span className="dashboard-schedule-group-count">{total}</span>
                            </header>
                            <ul className="dashboard-schedule-items">
                                {!loaded ? (
                                    <li className="dashboard-schedule-empty">Loading…</li>
                                ) : total === 0 ? (
                                    <li className="dashboard-schedule-empty">No items</li>
                                ) : (
                                    <>
                                        {groupItems.map(item => {
                                            const last = dispatchByItem[item.id];
                                            const lastRun = item.lastRunAt ? `last ${item.lastRunAt.slice(11, 16)}` : null;
                                            const lastStatus = item.lastStatus || null;
                                            return (
                                                <li
                                                    key={item.id}
                                                    className="dashboard-schedule-item"
                                                    data-persisted="true"
                                                    data-dispatch-status={last?.status || ''}
                                                >
                                                    <span className="dashboard-schedule-item-name">{item.title}</span>
                                                    <span className="dashboard-schedule-item-meta">
                                                        {describeWork(item)} • saved
                                                        {item.targetPort != null ? ` • :${item.targetPort}` : ''}
                                                        {lastRun ? ` • ${lastRun}` : ''}
                                                        {lastStatus ? ` • ${lastStatus}` : ''}
                                                        {last ? ` • ${last.status}` : ''}
                                                    </span>
                                                    <span
                                                        className="dashboard-schedule-item-actions"
                                                        data-open={movePopoverFor === item.id ? 'true' : 'false'}
                                                    >
                                                        <button
                                                            type="button"
                                                            className="dashboard-schedule-run-now"
                                                            onClick={() => void onDispatch(item.id)}
                                                            aria-label="Run now"
                                                            title="Dispatch to target instance (queued if busy)"
                                                        >Run</button>
                                                        <button
                                                            type="button"
                                                            className="dashboard-schedule-item-action"
                                                            onMouseDown={e => e.stopPropagation()}
                                                            onClick={() => setMovePopoverFor(prev => prev === item.id ? null : item.id)}
                                                            aria-haspopup="menu"
                                                            aria-expanded={movePopoverFor === item.id}
                                                            aria-label="Move scheduled work"
                                                        >Move</button>
                                                        <button
                                                            type="button"
                                                            className="dashboard-schedule-item-action"
                                                            data-danger="true"
                                                            onClick={() => void onDelete(item.id)}
                                                            aria-label="Delete"
                                                        >Delete</button>
                                                        {movePopoverFor === item.id && (
                                                            <div ref={popoverRef} className="dashboard-schedule-popover" role="menu">
                                                                {SCHEDULE_GROUPS.map(g => (
                                                                    <button
                                                                        key={g.id}
                                                                        type="button"
                                                                        className={`dashboard-schedule-popover-item${g.id === item.group ? ' is-current' : ''}`}
                                                                        role="menuitem"
                                                                        disabled={g.id === item.group}
                                                                        onClick={() => void onMove(item.id, g.id)}
                                                                    >{g.label}{g.id === item.group ? ' ✓' : ''}</button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </>
                                )}
                            </ul>
                            <div className="dashboard-schedule-group-add">
                                {isComposing ? (
                                    <form
                                        className="dashboard-schedule-add-composer"
                                        onSubmit={e => { e.preventDefault(); void onAdd(group.id); }}
                                    >
                                        <input
                                            autoFocus
                                            type="text"
                                            value={composerTitle}
                                            onChange={e => setComposerTitle(e.target.value)}
                                            placeholder={`New ${group.label} item`}
                                            disabled={busy}
                                            aria-label={`New scheduled work for ${group.label}`}
                                            onKeyDown={e => {
                                                if (e.key === 'Escape') {
                                                    setComposerGroup(null);
                                                    setComposerTitle('');
                                                }
                                            }}
                                        />
                                        <button type="submit" disabled={busy || !composerTitle.trim()}>Add</button>
                                        <button
                                            type="button"
                                            onClick={() => { setComposerGroup(null); setComposerTitle(''); }}
                                            aria-label="Cancel"
                                        >×</button>
                                    </form>
                                ) : (
                                    <button
                                        type="button"
                                        className="dashboard-schedule-add-trigger"
                                        onClick={() => { setComposerGroup(group.id); setComposerTitle(''); }}
                                    >+ Add scheduled work</button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

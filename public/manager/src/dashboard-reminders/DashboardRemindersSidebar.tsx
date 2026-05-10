import type { DragEvent } from 'react';
import type { DashboardReminder, DashboardReminderPatchInput } from './reminders-api';
import { nextRankBetween } from './reminder-order';
import { countRemindersView, rankTopPriorityItems } from './reminders-view-model';
import { useDashboardReminderDrag, type DashboardReminderDropTarget } from './useDashboardReminderDrag';

export type RemindersView = 'matrix' | 'focused' | 'important' | 'waiting' | 'later' | 'done';

type ViewItem = {
    id: RemindersView;
    label: string;
    detail: string;
};

const VIEWS: ViewItem[] = [
    { id: 'matrix', label: 'Matrix', detail: 'Priority board' },
    { id: 'focused', label: 'Focus', detail: 'Current item' },
    { id: 'important', label: 'Important', detail: 'Not urgent' },
    { id: 'waiting', label: 'Waiting', detail: 'Delegated' },
    { id: 'later', label: 'Later', detail: 'Low urgency' },
    { id: 'done', label: 'Done', detail: 'Completed items' },
];

type Props = {
    view: RemindersView;
    onViewChange: (view: RemindersView) => void;
    items: DashboardReminder[];
    loading: boolean;
    onRefresh: () => void;
    onUpdate: (id: string, patch: DashboardReminderPatchInput) => void;
};

function sameDropTarget(left: DashboardReminderDropTarget | null, right: DashboardReminderDropTarget): boolean {
    return Boolean(left && left.kind === right.kind && left.beforeId === right.beforeId && left.afterId === right.afterId);
}

function lastItem(items: DashboardReminder[]): DashboardReminder | null {
    return items.length > 0 ? items[items.length - 1] ?? null : null;
}

function targetAtPriorityRow(items: DashboardReminder[], index: number): DashboardReminderDropTarget {
    return { kind: 'priority', beforeId: items[index - 1]?.id ?? null, afterId: items[index]?.id ?? null };
}

function targetAtPriorityEnd(items: DashboardReminder[]): DashboardReminderDropTarget {
    return { kind: 'priority', beforeId: lastItem(items)?.id ?? null, afterId: null };
}

function resolveDropNeighbors(items: DashboardReminder[], draggedId: string, target: DashboardReminderDropTarget): { previous: DashboardReminder | null; next: DashboardReminder | null } {
    const remaining = items.filter(item => item.id !== draggedId);
    const previous = target.beforeId ? remaining.find(item => item.id === target.beforeId) ?? null : null;
    const next = target.afterId ? remaining.find(item => item.id === target.afterId) ?? null : null;
    if (previous || next) return { previous, next };
    if (target.beforeId && !target.afterId) return { previous: lastItem(remaining), next: null };
    if (!target.beforeId && target.afterId) return { previous: null, next: remaining[0] ?? null };
    return { previous: lastItem(remaining), next: null };
}

function PrioritySidebarList(props: {
    items: DashboardReminder[];
    loading: boolean;
    drag: ReturnType<typeof useDashboardReminderDrag>;
}) {
    const endDropTarget = targetAtPriorityEnd(props.items);
    const onDragOver = (target: DashboardReminderDropTarget, event: DragEvent): void => props.drag.over(target, event);
    const onDrop = (target: DashboardReminderDropTarget, event: DragEvent): void => props.drag.drop(target, event);
    return (
        <section
            className="dashboard-reminders-sidebar-priority"
            data-drop-target={props.drag.dropTarget?.kind === 'priority' ? 'true' : 'false'}
            onDragOver={event => onDragOver(endDropTarget, event)}
            onDragLeave={props.drag.leave}
            onDrop={event => onDrop(endDropTarget, event)}
        >
            <header>
                <span>Priority Order</span>
                <small>drag to rank</small>
            </header>
            <ol>
                {props.items.map((item, index) => {
                    const rowDropTarget = targetAtPriorityRow(props.items, index);
                    return (
                        <li
                            key={item.id}
                            draggable={!props.loading && item.status !== 'done'}
                            data-drop-target={sameDropTarget(props.drag.dropTarget, rowDropTarget) ? 'true' : undefined}
                            data-reminder-drop-before-id={rowDropTarget.beforeId ?? undefined}
                            data-reminder-drop-after-id={rowDropTarget.afterId ?? undefined}
                            onDragStart={event => props.drag.start(item, event)}
                            onDragEnd={props.drag.end}
                            onDragOver={event => {
                                event.stopPropagation();
                                onDragOver(rowDropTarget, event);
                            }}
                            onDragLeave={event => {
                                event.stopPropagation();
                                props.drag.leave();
                            }}
                            onDrop={event => {
                                event.stopPropagation();
                                onDrop(rowDropTarget, event);
                            }}
                        >
                            <span className="dashboard-reminders-sidebar-priority-index">{index + 1}</span>
                            <span>
                                <b>{item.title}</b>
                                <small>{item.status} • {item.priority}</small>
                            </span>
                        </li>
                    );
                })}
                {props.items.length === 0 ? <li className="dashboard-reminders-sidebar-priority-empty">No open reminders</li> : null}
            </ol>
        </section>
    );
}

export function DashboardRemindersSidebar(props: Props) {
    const openCount = props.items.filter(item => item.status !== 'done').length;
    const priorityItems = rankTopPriorityItems(props.items, 5);
    const drag = useDashboardReminderDrag((id, target) => {
        if (target.kind !== 'priority') return;
        const orderedItems = rankTopPriorityItems(props.items, props.items.length);
        const { previous, next } = resolveDropNeighbors(orderedItems, id, target);
        props.onUpdate(id, { manualRank: nextRankBetween(previous, next) });
    });
    return (
        <nav className="dashboard-reminders-sidebar" aria-label="Reminders views">
            <header className="dashboard-reminders-sidebar-header">
                <span className="dashboard-reminders-sidebar-title">Reminders</span>
                <button type="button" className="dashboard-reminders-refresh" onClick={props.onRefresh} disabled={props.loading}>
                    {props.loading ? 'Loading' : 'Refresh'}
                </button>
            </header>
            <div className="dashboard-reminders-source" data-state="ok">
                {openCount} open / {props.items.length} total
            </div>
            <PrioritySidebarList items={priorityItems} loading={props.loading} drag={drag} />
            <ul className="dashboard-reminders-sidebar-list">
                {VIEWS.map(view => (
                    <li key={view.id}>
                        <button
                            type="button"
                            className={`dashboard-reminders-sidebar-item${props.view === view.id ? ' is-active' : ''}`}
                            onClick={() => props.onViewChange(view.id)}
                            aria-pressed={props.view === view.id}
                        >
                            <span>{view.label}</span>
                            <small>{view.detail}</small>
                            <b>{countRemindersView(view.id, props.items)}</b>
                        </button>
                    </li>
                ))}
            </ul>
        </nav>
    );
}

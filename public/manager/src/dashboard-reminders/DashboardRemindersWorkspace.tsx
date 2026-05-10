import { useState, type DragEvent } from 'react';
import type { RemindersFeedState } from './useRemindersFeed';
import type { DashboardReminder, DashboardReminderCreateInput, DashboardReminderPatchInput } from './reminders-api';
import type { RemindersView } from './DashboardRemindersSidebar';
import { InlineReminderTitle } from './InlineReminderTitle';
import { ReminderDetailPopover } from './ReminderDetailPopover';
import { useDashboardReminderDrag, type DashboardReminderDropTarget } from './useDashboardReminderDrag';
import { nextRankBetween } from './reminder-order';
import {
    MATRIX_DEFAULTS,
    MATRIX_SECTIONS,
    matrixBucketToPatch,
    matrixItems,
    rankTopPriorityItems,
    remindersForView,
    resolveReminderMatrixBucket,
    type MatrixBucket,
    type MatrixSection,
} from './reminders-view-model';

type Props = {
    active: boolean;
    view: RemindersView;
    feed: RemindersFeedState;
    onRefresh: () => void;
    onCreate: (input: DashboardReminderCreateInput) => void;
    onUpdate: (id: string, patch: DashboardReminderPatchInput) => void;
};

const VIEW_TITLES: Record<RemindersView, string> = {
    matrix: 'Priority Matrix',
    focused: 'Focus',
    important: 'Important, Not Urgent',
    waiting: 'Waiting / Delegated',
    later: 'Later',
    done: 'Done',
};

function formatWhen(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusText(item: DashboardReminder): string {
    const chunks: string[] = [item.status, item.priority];
    const remindAt = formatWhen(item.remindAt);
    const dueAt = formatWhen(item.dueAt);
    if (dueAt) chunks.push(`due ${dueAt}`);
    if (remindAt) chunks.push(`remind ${remindAt}`);
    if (item.linkedInstance) chunks.push(item.linkedInstance);
    if (item.notificationStatus !== 'pending') chunks.push(item.notificationStatus);
    return chunks.join(' • ');
}

function sameDropTarget(left: DashboardReminderDropTarget | null, right: DashboardReminderDropTarget): boolean {
    if (!left || left.kind !== right.kind) return false;
    if (left.beforeId !== right.beforeId || left.afterId !== right.afterId) return false;
    return left.kind === 'bucket' && right.kind === 'bucket' ? left.bucket === right.bucket : true;
}

function targetAtBucketRow(bucket: MatrixBucket, items: DashboardReminder[], index: number): DashboardReminderDropTarget {
    return { kind: 'bucket', bucket, beforeId: items[index - 1]?.id ?? null, afterId: items[index]?.id ?? null };
}

function targetAtBucketEnd(bucket: MatrixBucket, items: DashboardReminder[]): DashboardReminderDropTarget {
    return { kind: 'bucket', bucket, beforeId: lastItem(items)?.id ?? null, afterId: null };
}

function targetAtPriorityRow(items: DashboardReminder[], index: number): DashboardReminderDropTarget {
    return { kind: 'priority', beforeId: items[index - 1]?.id ?? null, afterId: items[index]?.id ?? null };
}

function targetAtPriorityEnd(items: DashboardReminder[]): DashboardReminderDropTarget {
    return { kind: 'priority', beforeId: lastItem(items)?.id ?? null, afterId: null };
}

function orderedItemsForTarget(items: DashboardReminder[], target: DashboardReminderDropTarget): DashboardReminder[] {
    if (target.kind === 'priority') return rankTopPriorityItems(items, items.length);
    return matrixItems(target.bucket, items);
}

function lastItem(items: DashboardReminder[]): DashboardReminder | null {
    return items.length > 0 ? items[items.length - 1] ?? null : null;
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

function StorageStatus(props: { feed: RemindersFeedState }) {
    if (props.feed.error) {
        return <p className="dashboard-reminders-status" data-state="error">{props.feed.error}</p>;
    }
    return (
        <p className="dashboard-reminders-status">
            {props.feed.items.length} reminder(s) stored in the dashboard database
        </p>
    );
}

function ReminderRow(props: {
    item: DashboardReminder;
    busy: boolean;
    onToggleDone: (item: DashboardReminder) => void;
    onRename: (id: string, title: string) => void;
    onOpenDetails: (item: DashboardReminder) => void;
    onDragStart?: (item: DashboardReminder, event: DragEvent) => void;
    onDragEnd?: () => void;
    dropTarget?: DashboardReminderDropTarget;
    activeDropTarget?: DashboardReminderDropTarget | null;
    onDragOverTarget?: (target: DashboardReminderDropTarget, event: DragEvent) => void;
    onDragLeaveTarget?: () => void;
    onDropTarget?: (target: DashboardReminderDropTarget, event: DragEvent) => void;
}) {
    const done = props.item.status === 'done';
    const dropActive = props.dropTarget ? sameDropTarget(props.activeDropTarget ?? null, props.dropTarget) : false;
    return (
        <li
            className="dashboard-reminders-row"
            data-priority={props.item.priority}
            data-status={props.item.status}
            data-drop-target={dropActive ? 'true' : undefined}
            data-reminder-drop-before-id={props.dropTarget?.beforeId ?? undefined}
            data-reminder-drop-after-id={props.dropTarget?.afterId ?? undefined}
            draggable={!done && !props.busy}
            onDragStart={event => props.onDragStart?.(props.item, event)}
            onDragEnd={props.onDragEnd}
            onDragOver={event => {
                if (!props.dropTarget) return;
                event.stopPropagation();
                props.onDragOverTarget?.(props.dropTarget, event);
            }}
            onDragLeave={event => {
                if (!props.dropTarget) return;
                event.stopPropagation();
                props.onDragLeaveTarget?.();
            }}
            onDrop={event => {
                if (!props.dropTarget) return;
                event.stopPropagation();
                props.onDropTarget?.(props.dropTarget, event);
            }}
        >
            <button type="button" className="dashboard-reminders-row-check" aria-label={done ? 'Mark open' : 'Mark done'} onClick={() => props.onToggleDone(props.item)}>
                {done ? '✓' : ''}
            </button>
            <span className="dashboard-reminders-row-content">
                <InlineReminderTitle
                    item={props.item}
                    busy={props.busy}
                    onRename={props.onRename}
                />
                <small>{statusText(props.item)}</small>
            </span>
            <button type="button" className="dashboard-reminders-row-more" aria-label="Open reminder details" onClick={() => props.onOpenDetails(props.item)}>
                •••
            </button>
            {props.item.priority === 'high' ? <span className="dashboard-reminders-row-flag" aria-label="high priority">!</span> : null}
        </li>
    );
}

function MatrixCreateRow(props: { bucket: MatrixBucket; onCreate: (input: DashboardReminderCreateInput) => void }) {
    const [title, setTitle] = useState('');
    return (
        <li className="dashboard-reminders-create-row">
            <span aria-hidden="true" />
            <form onSubmit={(event) => {
                event.preventDefault();
                const nextTitle = title.trim();
                if (!nextTitle) return;
                props.onCreate({ title: nextTitle, ...MATRIX_DEFAULTS[props.bucket] });
                setTitle('');
            }}>
                <input aria-label={`Create ${props.bucket} reminder`} placeholder="New reminder" value={title} onChange={(event) => setTitle(event.target.value)} />
            </form>
        </li>
    );
}

function MatrixQuadrant(props: {
    section: MatrixSection;
    items: DashboardReminder[];
    busy: boolean;
    dropTarget: DashboardReminderDropTarget | null;
    onCreate: (input: DashboardReminderCreateInput) => void;
    onToggleDone: (item: DashboardReminder) => void;
    onRename: (id: string, title: string) => void;
    onOpenDetails: (item: DashboardReminder) => void;
    onDragStart: (item: DashboardReminder, event: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (target: DashboardReminderDropTarget, event: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (target: DashboardReminderDropTarget, event: DragEvent) => void;
}) {
    const bucketDropTarget = targetAtBucketEnd(props.section.id, props.items);
    return (
        <section
            className="dashboard-reminders-quadrant"
            data-tone={props.section.tone}
            data-drop-target={props.dropTarget?.kind === 'bucket' && props.dropTarget.bucket === props.section.id ? 'true' : 'false'}
            onDragOver={event => props.onDragOver(bucketDropTarget, event)}
            onDragLeave={props.onDragLeave}
            onDrop={event => props.onDrop(bucketDropTarget, event)}
        >
            <header>
                <h3>{props.section.title}</h3>
                <span>{props.items.length}</span>
            </header>
            <ul>
                {props.items.map((item, index) => {
                    const rowDropTarget = targetAtBucketRow(props.section.id, props.items, index);
                    return (
                        <ReminderRow
                            key={item.id}
                            item={item}
                            busy={props.busy}
                            onToggleDone={props.onToggleDone}
                            onRename={props.onRename}
                            onOpenDetails={props.onOpenDetails}
                            onDragStart={props.onDragStart}
                            onDragEnd={props.onDragEnd}
                            dropTarget={rowDropTarget}
                            activeDropTarget={props.dropTarget}
                            onDragOverTarget={props.onDragOver}
                            onDragLeaveTarget={props.onDragLeave}
                            onDropTarget={props.onDrop}
                        />
                    );
                })}
                <MatrixCreateRow bucket={props.section.id} onCreate={props.onCreate} />
                {props.items.length === 0 ? <li className="dashboard-reminders-empty-row">No reminders</li> : null}
            </ul>
        </section>
    );
}

function MatrixBoard(props: {
    items: DashboardReminder[];
    busy: boolean;
    dropTarget: DashboardReminderDropTarget | null;
    onCreate: (input: DashboardReminderCreateInput) => void;
    onToggleDone: (item: DashboardReminder) => void;
    onRename: (id: string, title: string) => void;
    onOpenDetails: (item: DashboardReminder) => void;
    onDragStart: (item: DashboardReminder, event: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (target: DashboardReminderDropTarget, event: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (target: DashboardReminderDropTarget, event: DragEvent) => void;
}) {
    return (
        <div className="dashboard-reminders-matrix-wrap">
            <span className="dashboard-reminders-axis dashboard-reminders-axis-importance">Importance</span>
            <span className="dashboard-reminders-axis dashboard-reminders-axis-urgency">Urgency</span>
            <div className="dashboard-reminders-matrix-board">
                {MATRIX_SECTIONS.map(section => (
                    <MatrixQuadrant
                        key={section.id}
                        section={section}
                        items={matrixItems(section.id, props.items)}
                        busy={props.busy}
                        dropTarget={props.dropTarget}
                        onCreate={props.onCreate}
                        onToggleDone={props.onToggleDone}
                        onRename={props.onRename}
                        onOpenDetails={props.onOpenDetails}
                        onDragStart={props.onDragStart}
                        onDragEnd={props.onDragEnd}
                        onDragOver={props.onDragOver}
                        onDragLeave={props.onDragLeave}
                        onDrop={props.onDrop}
                    />
                ))}
            </div>
        </div>
    );
}

function TopPriorityStrip(props: {
    items: DashboardReminder[];
    busy: boolean;
    dropTarget: DashboardReminderDropTarget | null;
    onToggleDone: (item: DashboardReminder) => void;
    onRename: (id: string, title: string) => void;
    onOpenDetails: (item: DashboardReminder) => void;
    onDragStart: (item: DashboardReminder, event: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (target: DashboardReminderDropTarget, event: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (target: DashboardReminderDropTarget, event: DragEvent) => void;
}) {
    const endDropTarget = targetAtPriorityEnd(props.items);
    return (
        <section
            className="dashboard-reminders-top-priority"
            aria-label="Top priority reminders"
            data-drop-target={props.dropTarget?.kind === 'priority' ? 'true' : 'false'}
            onDragOver={event => props.onDragOver(endDropTarget, event)}
            onDragLeave={props.onDragLeave}
            onDrop={event => props.onDrop(endDropTarget, event)}
        >
            <header>
                <span>Top Priority 3</span>
                <small>{props.items.length}/3</small>
            </header>
            <ol>
                {props.items.map((item, index) => {
                    const rowDropTarget = targetAtPriorityRow(props.items, index);
                    return (
                        <li key={item.id}>
                            <span className="dashboard-reminders-top-index">{index + 1}</span>
                            <ReminderRow
                                item={item}
                                busy={props.busy}
                                onToggleDone={props.onToggleDone}
                                onRename={props.onRename}
                                onOpenDetails={props.onOpenDetails}
                                onDragStart={props.onDragStart}
                                onDragEnd={props.onDragEnd}
                                dropTarget={rowDropTarget}
                                activeDropTarget={props.dropTarget}
                                onDragOverTarget={props.onDragOver}
                                onDragLeaveTarget={props.onDragLeave}
                                onDropTarget={props.onDrop}
                            />
                        </li>
                    );
                })}
                {props.items.length === 0 ? <li className="dashboard-reminders-top-empty">No top priority reminders</li> : null}
            </ol>
        </section>
    );
}

function SmartList(props: {
    title: string;
    items: DashboardReminder[];
    loading: boolean;
    onToggleDone: (item: DashboardReminder) => void;
    onRename: (id: string, title: string) => void;
    onOpenDetails: (item: DashboardReminder) => void;
    onDragStart: (item: DashboardReminder, event: DragEvent) => void;
    onDragEnd: () => void;
}) {
    return (
        <div className="dashboard-reminders-smart-list" aria-busy={props.loading}>
            <header>
                <h3>{props.title}</h3>
                <span>{props.items.length}</span>
            </header>
            <ul>
                {props.loading && props.items.length === 0 ? (
                    <li className="dashboard-reminders-empty-row">Loading reminders...</li>
                ) : props.items.length === 0 ? (
                    <li className="dashboard-reminders-empty-row">No reminders</li>
                ) : (
                    props.items.map(item => (
                        <ReminderRow
                            key={item.id}
                            item={item}
                            busy={props.loading}
                            onToggleDone={props.onToggleDone}
                            onRename={props.onRename}
                            onOpenDetails={props.onOpenDetails}
                            onDragStart={props.onDragStart}
                            onDragEnd={props.onDragEnd}
                        />
                    ))
                )}
            </ul>
        </div>
    );
}

export function DashboardRemindersWorkspace(props: Props) {
    const [detailItem, setDetailItem] = useState<DashboardReminder | null>(null);
    const visibleItems = remindersForView(props.view, props.feed.items);
    const title = VIEW_TITLES[props.view];
    const topItems = rankTopPriorityItems(props.feed.items, 3);
    const drag = useDashboardReminderDrag((id, target) => {
        const item = props.feed.items.find(candidate => candidate.id === id);
        if (!item) return;
        const orderedItems = orderedItemsForTarget(props.feed.items, target);
        const { previous, next } = resolveDropNeighbors(orderedItems, id, target);
        const manualRank = nextRankBetween(previous, next);
        if (target.kind === 'priority') {
            props.onUpdate(id, { manualRank });
            return;
        }
        const bucketPatch = resolveReminderMatrixBucket(item) === target.bucket ? {} : matrixBucketToPatch(target.bucket);
        props.onUpdate(id, { ...bucketPatch, manualRank });
    });
    const toggleDone = (item: DashboardReminder): void => {
        props.onUpdate(item.id, { status: item.status === 'done' ? 'open' : 'done' });
    };
    const renameReminder = (id: string, title: string): void => {
        props.onUpdate(id, { title });
    };
    return (
        <section className="dashboard-reminders-workspace" aria-hidden={!props.active}>
            <header className="dashboard-reminders-workspace-header">
                <div>
                    <h2>{title}</h2>
                    <StorageStatus feed={props.feed} />
                </div>
                <button type="button" className="dashboard-reminders-sync-button" onClick={props.onRefresh} disabled={props.feed.loading}>
                    {props.feed.loading ? 'Loading...' : 'Refresh'}
                </button>
            </header>
            {props.view === 'matrix' ? (
                <>
                    <TopPriorityStrip
                        items={topItems}
                        busy={props.feed.loading}
                        dropTarget={drag.dropTarget}
                        onToggleDone={toggleDone}
                        onRename={renameReminder}
                        onOpenDetails={setDetailItem}
                        onDragStart={drag.start}
                        onDragEnd={drag.end}
                        onDragOver={drag.over}
                        onDragLeave={drag.leave}
                        onDrop={drag.drop}
                    />
                    <MatrixBoard
                        items={visibleItems}
                        busy={props.feed.loading}
                        dropTarget={drag.dropTarget}
                        onCreate={props.onCreate}
                        onToggleDone={toggleDone}
                        onRename={renameReminder}
                        onOpenDetails={setDetailItem}
                        onDragStart={drag.start}
                        onDragEnd={drag.end}
                        onDragOver={drag.over}
                        onDragLeave={drag.leave}
                        onDrop={drag.drop}
                    />
                </>
            ) : (
                <SmartList
                    title={title}
                    items={visibleItems}
                    loading={props.feed.loading}
                    onToggleDone={toggleDone}
                    onRename={renameReminder}
                    onOpenDetails={setDetailItem}
                    onDragStart={drag.start}
                    onDragEnd={drag.end}
                />
            )}
            <ReminderDetailPopover
                item={detailItem}
                busy={props.feed.loading}
                onClose={() => setDetailItem(null)}
                onSave={(id, patch) => {
                    props.onUpdate(id, patch);
                    setDetailItem(null);
                }}
            />
        </section>
    );
}

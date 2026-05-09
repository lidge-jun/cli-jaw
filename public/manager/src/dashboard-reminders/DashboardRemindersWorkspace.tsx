import { useState, type DragEvent } from 'react';
import type { RemindersFeedState } from './useRemindersFeed';
import type { DashboardReminder, DashboardReminderCreateInput, DashboardReminderPatchInput } from './reminders-api';
import type { RemindersView } from './DashboardRemindersSidebar';
import { ReminderDetailPopover } from './ReminderDetailPopover';
import { useDashboardReminderDrag } from './useDashboardReminderDrag';
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
    onToggleDone: (item: DashboardReminder) => void;
    onOpenDetails: (item: DashboardReminder) => void;
    onDragStart?: (item: DashboardReminder, event: DragEvent) => void;
    onDragEnd?: () => void;
}) {
    const done = props.item.status === 'done';
    return (
        <li
            className="dashboard-reminders-row"
            data-priority={props.item.priority}
            data-status={props.item.status}
            draggable={!done}
            onDragStart={event => props.onDragStart?.(props.item, event)}
            onDragEnd={props.onDragEnd}
        >
            <button type="button" className="dashboard-reminders-row-check" aria-label={done ? 'Mark open' : 'Mark done'} onClick={() => props.onToggleDone(props.item)}>
                {done ? '✓' : ''}
            </button>
            <span className="dashboard-reminders-row-content">
                <span className="dashboard-reminders-row-title">{props.item.title}</span>
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
    dropTarget: MatrixBucket | null;
    onCreate: (input: DashboardReminderCreateInput) => void;
    onToggleDone: (item: DashboardReminder) => void;
    onOpenDetails: (item: DashboardReminder) => void;
    onDragStart: (item: DashboardReminder, event: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (bucket: MatrixBucket, event: DragEvent) => void;
    onDragLeave: (bucket: MatrixBucket) => void;
    onDrop: (bucket: MatrixBucket, event: DragEvent) => void;
}) {
    return (
        <section
            className="dashboard-reminders-quadrant"
            data-tone={props.section.tone}
            data-drop-target={props.dropTarget === props.section.id ? 'true' : 'false'}
            onDragOver={event => props.onDragOver(props.section.id, event)}
            onDragLeave={() => props.onDragLeave(props.section.id)}
            onDrop={event => props.onDrop(props.section.id, event)}
        >
            <header>
                <h3>{props.section.title}</h3>
                <span>{props.items.length}</span>
            </header>
            <ul>
                {props.items.map(item => (
                    <ReminderRow
                        key={item.id}
                        item={item}
                        onToggleDone={props.onToggleDone}
                        onOpenDetails={props.onOpenDetails}
                        onDragStart={props.onDragStart}
                        onDragEnd={props.onDragEnd}
                    />
                ))}
                <MatrixCreateRow bucket={props.section.id} onCreate={props.onCreate} />
                {props.items.length === 0 ? <li className="dashboard-reminders-empty-row">No reminders</li> : null}
            </ul>
        </section>
    );
}

function MatrixBoard(props: {
    items: DashboardReminder[];
    dropTarget: MatrixBucket | null;
    onCreate: (input: DashboardReminderCreateInput) => void;
    onToggleDone: (item: DashboardReminder) => void;
    onOpenDetails: (item: DashboardReminder) => void;
    onDragStart: (item: DashboardReminder, event: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (bucket: MatrixBucket, event: DragEvent) => void;
    onDragLeave: (bucket: MatrixBucket) => void;
    onDrop: (bucket: MatrixBucket, event: DragEvent) => void;
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
                        dropTarget={props.dropTarget}
                        onCreate={props.onCreate}
                        onToggleDone={props.onToggleDone}
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
    onToggleDone: (item: DashboardReminder) => void;
    onOpenDetails: (item: DashboardReminder) => void;
    onDragStart: (item: DashboardReminder, event: DragEvent) => void;
    onDragEnd: () => void;
}) {
    return (
        <section className="dashboard-reminders-top-priority" aria-label="Top priority reminders">
            <header>
                <span>Top Priority 3</span>
                <small>{props.items.length}/3</small>
            </header>
            <ol>
                {props.items.map((item, index) => (
                    <li key={item.id}>
                        <span className="dashboard-reminders-top-index">{index + 1}</span>
                        <ReminderRow
                            item={item}
                            onToggleDone={props.onToggleDone}
                            onOpenDetails={props.onOpenDetails}
                            onDragStart={props.onDragStart}
                            onDragEnd={props.onDragEnd}
                        />
                    </li>
                ))}
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
                            onToggleDone={props.onToggleDone}
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
    const drag = useDashboardReminderDrag((id, bucket) => {
        const item = props.feed.items.find(candidate => candidate.id === id);
        if (!item || resolveReminderMatrixBucket(item) === bucket) return;
        props.onUpdate(id, matrixBucketToPatch(bucket));
    });
    const toggleDone = (item: DashboardReminder): void => {
        props.onUpdate(item.id, { status: item.status === 'done' ? 'open' : 'done' });
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
                    <TopPriorityStrip items={topItems} onToggleDone={toggleDone} onOpenDetails={setDetailItem} onDragStart={drag.start} onDragEnd={drag.end} />
                    <MatrixBoard
                        items={visibleItems}
                        dropTarget={drag.dropBucket}
                        onCreate={props.onCreate}
                        onToggleDone={toggleDone}
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

import { useState } from 'react';
import type { RemindersFeedState } from './useRemindersFeed';
import type { DashboardReminder, DashboardReminderCreateInput, DashboardReminderPatchInput } from './reminders-api';
import type { RemindersView } from './DashboardRemindersSidebar';

type MatrixBucket = 'urgentImportant' | 'important' | 'waiting' | 'later';

type MatrixSection = {
    id: MatrixBucket;
    title: string;
    tone: 'red' | 'green' | 'amber' | 'blue';
};

type Props = {
    active: boolean;
    view: RemindersView;
    feed: RemindersFeedState;
    onRefresh: () => void;
    onCreate: (input: DashboardReminderCreateInput) => void;
    onUpdate: (id: string, patch: DashboardReminderPatchInput) => void;
};

const MATRIX_SECTIONS: MatrixSection[] = [
    { id: 'urgentImportant', title: 'Important and Urgent', tone: 'red' },
    { id: 'important', title: 'Important, Not Urgent', tone: 'green' },
    { id: 'waiting', title: 'Waiting / Delegated', tone: 'amber' },
    { id: 'later', title: 'Later', tone: 'blue' },
];

const VIEW_TITLES: Record<RemindersView, string> = {
    matrix: 'Priority Matrix',
    focused: 'Focus',
    important: 'Important, Not Urgent',
    waiting: 'Waiting / Delegated',
    later: 'Later',
    done: 'Done',
};

const MATRIX_DEFAULTS: Record<MatrixBucket, Pick<DashboardReminderCreateInput, 'listId' | 'status' | 'priority'>> = {
    urgentImportant: { listId: 'today', status: 'open', priority: 'high' },
    important: { listId: 'today', status: 'open', priority: 'normal' },
    waiting: { listId: 'waiting', status: 'waiting', priority: 'normal' },
    later: { listId: 'later', status: 'open', priority: 'low' },
};

function filteredItems(view: RemindersView, items: DashboardReminder[]): DashboardReminder[] {
    if (view === 'focused') return items.filter(item => item.status === 'focused');
    if (view === 'important') return matrixItems('important', items);
    if (view === 'waiting') return items.filter(item => item.status === 'waiting');
    if (view === 'later') return items.filter(item => item.status !== 'done' && (item.listId === 'later' || item.priority === 'low'));
    if (view === 'done') return items.filter(item => item.status === 'done');
    return items.filter(item => item.status !== 'done');
}

function resolveMatrixBucket(item: DashboardReminder): MatrixBucket | null {
    if (item.status === 'done') return null;
    if (item.status === 'focused') return 'urgentImportant';
    if (item.status === 'waiting') return 'waiting';
    if (item.listId === 'later' || item.priority === 'low') return 'later';
    if (item.priority === 'high') return 'urgentImportant';
    return 'important';
}

function matrixItems(bucket: MatrixBucket, items: DashboardReminder[]): DashboardReminder[] {
    return items.filter(item => resolveMatrixBucket(item) === bucket);
}

function topPriorityItems(items: DashboardReminder[]): DashboardReminder[] {
    return matrixItems('urgentImportant', items).slice(0, 3);
}

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

function ReminderRow(props: { item: DashboardReminder; onToggleDone: (item: DashboardReminder) => void }) {
    const done = props.item.status === 'done';
    return (
        <li className="dashboard-reminders-row" data-priority={props.item.priority} data-status={props.item.status}>
            <button type="button" className="dashboard-reminders-row-check" aria-label={done ? 'Mark open' : 'Mark done'} onClick={() => props.onToggleDone(props.item)}>
                {done ? '✓' : ''}
            </button>
            <span className="dashboard-reminders-row-content">
                <span className="dashboard-reminders-row-title">{props.item.title}</span>
                <small>{statusText(props.item)}</small>
            </span>
            <span className="dashboard-reminders-row-more" aria-hidden="true">•••</span>
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
    onCreate: (input: DashboardReminderCreateInput) => void;
    onToggleDone: (item: DashboardReminder) => void;
}) {
    return (
        <section className="dashboard-reminders-quadrant" data-tone={props.section.tone}>
            <header>
                <h3>{props.section.title}</h3>
                <span>{props.items.length}</span>
            </header>
            <ul>
                {props.items.map(item => <ReminderRow key={item.id} item={item} onToggleDone={props.onToggleDone} />)}
                <MatrixCreateRow bucket={props.section.id} onCreate={props.onCreate} />
                {props.items.length === 0 ? <li className="dashboard-reminders-empty-row">No reminders</li> : null}
            </ul>
        </section>
    );
}

function MatrixBoard(props: {
    items: DashboardReminder[];
    onCreate: (input: DashboardReminderCreateInput) => void;
    onToggleDone: (item: DashboardReminder) => void;
}) {
    return (
        <div className="dashboard-reminders-matrix-wrap">
            <span className="dashboard-reminders-axis dashboard-reminders-axis-importance">Importance</span>
            <span className="dashboard-reminders-axis dashboard-reminders-axis-urgency">Urgency</span>
            <div className="dashboard-reminders-matrix-board">
                {MATRIX_SECTIONS.map(section => (
                    <MatrixQuadrant key={section.id} section={section} items={matrixItems(section.id, props.items)} onCreate={props.onCreate} onToggleDone={props.onToggleDone} />
                ))}
            </div>
        </div>
    );
}

function TopPriorityStrip(props: { items: DashboardReminder[]; onToggleDone: (item: DashboardReminder) => void }) {
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
                        <ReminderRow item={item} onToggleDone={props.onToggleDone} />
                    </li>
                ))}
                {props.items.length === 0 ? <li className="dashboard-reminders-top-empty">No top priority reminders</li> : null}
            </ol>
        </section>
    );
}

function SmartList(props: { title: string; items: DashboardReminder[]; loading: boolean; onToggleDone: (item: DashboardReminder) => void }) {
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
                    props.items.map(item => <ReminderRow key={item.id} item={item} onToggleDone={props.onToggleDone} />)
                )}
            </ul>
        </div>
    );
}

export function DashboardRemindersWorkspace(props: Props) {
    const items = filteredItems(props.view, props.feed.items);
    const title = VIEW_TITLES[props.view];
    const topItems = topPriorityItems(items);
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
                    <TopPriorityStrip items={topItems} onToggleDone={toggleDone} />
                    <MatrixBoard items={items} onCreate={props.onCreate} onToggleDone={toggleDone} />
                </>
            ) : (
                <SmartList title={title} items={items} loading={props.feed.loading} onToggleDone={toggleDone} />
            )}
        </section>
    );
}

import type { RemindersFeedState } from './useRemindersFeed';
import type { DashboardReminder } from './reminders-api';
import type { RemindersView } from './DashboardRemindersSidebar';

type Props = {
    active: boolean;
    view: RemindersView;
    feed: RemindersFeedState;
    onRefresh: () => void;
};

function filteredItems(view: RemindersView, items: DashboardReminder[]): DashboardReminder[] {
    if (view === 'focused') return items.filter(item => item.status === 'focused');
    if (view === 'scheduled') return items.filter(item => item.dueAt || item.remindAt);
    if (view === 'high') return items.filter(item => item.priority === 'high' && item.status !== 'done');
    if (view === 'done') return items.filter(item => item.status === 'done');
    return items.filter(item => item.status !== 'done');
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
    if (remindAt) chunks.push(`remind ${remindAt}`);
    if (dueAt) chunks.push(`due ${dueAt}`);
    if (item.linkedInstance) chunks.push(`:${item.linkedInstance}`);
    if (item.notificationStatus !== 'pending') chunks.push(item.notificationStatus);
    return chunks.join(' • ');
}

function SourceStatus(props: { feed: RemindersFeedState }) {
    const status = props.feed.sourceStatus;
    if (props.feed.error) {
        return <p className="dashboard-reminders-status" data-state="error">{props.feed.error}</p>;
    }
    if (!status) {
        return <p className="dashboard-reminders-status">Sync with Jaw Reminders to populate the dashboard mirror.</p>;
    }
    if (!status.ok) {
        return <p className="dashboard-reminders-status" data-state="error">{status.message}</p>;
    }
    return (
        <p className="dashboard-reminders-status">
            Synced {status.reminders} item(s) from {status.sourcePath}
        </p>
    );
}

export function DashboardRemindersWorkspace(props: Props) {
    const items = filteredItems(props.view, props.feed.items);
    return (
        <section className="dashboard-reminders-workspace" aria-hidden={!props.active}>
            <header className="dashboard-reminders-workspace-header">
                <div>
                    <h2>Reminders</h2>
                    <SourceStatus feed={props.feed} />
                </div>
                <button type="button" className="dashboard-reminders-sync-button" onClick={props.onRefresh} disabled={props.feed.loading}>
                    {props.feed.loading ? 'Syncing…' : 'Refresh'}
                </button>
            </header>
            <div className="dashboard-reminders-list" aria-busy={props.feed.loading}>
                {props.feed.loading && items.length === 0 ? (
                    <div className="dashboard-reminders-empty">Loading reminders…</div>
                ) : items.length === 0 ? (
                    <div className="dashboard-reminders-empty">No reminders in this view</div>
                ) : (
                    items.map(item => (
                        <article key={item.id} className="dashboard-reminders-card" data-priority={item.priority} data-status={item.status}>
                            <header className="dashboard-reminders-card-header">
                                <span className="dashboard-reminders-card-title">{item.title}</span>
                                <span className="dashboard-reminders-card-source">{item.source}</span>
                            </header>
                            {item.notes ? <p className="dashboard-reminders-card-notes">{item.notes}</p> : null}
                            <div className="dashboard-reminders-card-meta">{statusText(item)}</div>
                            {item.subtasks.length > 0 ? (
                                <ul className="dashboard-reminders-subtasks">
                                    {item.subtasks.map(subtask => (
                                        <li key={subtask.id} data-done={subtask.done ? 'true' : 'false'}>
                                            {subtask.title}
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </article>
                    ))
                )}
            </div>
        </section>
    );
}

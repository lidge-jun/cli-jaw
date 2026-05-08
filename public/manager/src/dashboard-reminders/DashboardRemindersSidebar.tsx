import type { DashboardReminder, DashboardRemindersSourceStatus } from './reminders-api';

export type RemindersView = 'all' | 'focused' | 'scheduled' | 'high' | 'done';

type ViewItem = {
    id: RemindersView;
    label: string;
    detail: string;
};

const VIEWS: ViewItem[] = [
    { id: 'all', label: 'All', detail: 'Open mirror' },
    { id: 'focused', label: 'Focus', detail: 'Current item' },
    { id: 'scheduled', label: 'Scheduled', detail: 'Due or remind time' },
    { id: 'high', label: 'High priority', detail: 'Needs attention' },
    { id: 'done', label: 'Done', detail: 'Completed items' },
];

type Props = {
    view: RemindersView;
    onViewChange: (view: RemindersView) => void;
    items: DashboardReminder[];
    loading: boolean;
    sourceStatus: DashboardRemindersSourceStatus | null;
    onRefresh: () => void;
};

function countFor(view: RemindersView, items: DashboardReminder[]): number {
    if (view === 'focused') return items.filter(item => item.status === 'focused').length;
    if (view === 'scheduled') return items.filter(item => item.dueAt || item.remindAt).length;
    if (view === 'high') return items.filter(item => item.priority === 'high' && item.status !== 'done').length;
    if (view === 'done') return items.filter(item => item.status === 'done').length;
    return items.length;
}

function sourceLabel(status: DashboardRemindersSourceStatus | null): string {
    if (!status) return 'not synced';
    if (!status.ok) return status.code;
    return `${status.reminders} mirrored`;
}

export function DashboardRemindersSidebar(props: Props) {
    return (
        <nav className="dashboard-reminders-sidebar" aria-label="Reminders views">
            <header className="dashboard-reminders-sidebar-header">
                <span className="dashboard-reminders-sidebar-title">Reminders</span>
                <button type="button" className="dashboard-reminders-refresh" onClick={props.onRefresh} disabled={props.loading}>
                    {props.loading ? 'Syncing' : 'Sync'}
                </button>
            </header>
            <div className="dashboard-reminders-source" data-state={props.sourceStatus?.ok === false ? 'error' : 'ok'}>
                {sourceLabel(props.sourceStatus)}
            </div>
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
                            <b>{countFor(view.id, props.items)}</b>
                        </button>
                    </li>
                ))}
            </ul>
        </nav>
    );
}

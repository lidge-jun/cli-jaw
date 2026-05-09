import type { DashboardReminder } from './reminders-api';

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
};

function countFor(view: RemindersView, items: DashboardReminder[]): number {
    if (view === 'focused') return items.filter(item => item.status === 'focused').length;
    if (view === 'important') return items.filter(item => item.status !== 'done' && item.status !== 'focused' && item.status !== 'waiting' && item.listId !== 'later' && item.priority === 'normal').length;
    if (view === 'waiting') return items.filter(item => item.status === 'waiting').length;
    if (view === 'later') return items.filter(item => item.status !== 'done' && (item.listId === 'later' || item.priority === 'low')).length;
    if (view === 'done') return items.filter(item => item.status === 'done').length;
    return items.filter(item => item.status !== 'done').length;
}

export function DashboardRemindersSidebar(props: Props) {
    const openCount = props.items.filter(item => item.status !== 'done').length;
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

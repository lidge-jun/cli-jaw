type ScheduleGroup = 'today' | 'upcoming' | 'recurring' | 'blocked';

const GROUPS: { id: ScheduleGroup; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'recurring', label: 'Recurring' },
    { id: 'blocked', label: 'Blocked' },
];

type Props = {
    activeGroup: ScheduleGroup;
    onGroupChange: (group: ScheduleGroup) => void;
};

export function DashboardScheduleSidebar(props: Props) {
    return (
        <nav className="dashboard-schedule-sidebar" aria-label="Schedule groups">
            <header className="dashboard-schedule-sidebar-header">
                <span className="dashboard-schedule-sidebar-title">Schedule</span>
            </header>
            <ul className="dashboard-schedule-sidebar-list">
                {GROUPS.map(group => (
                    <li key={group.id}>
                        <button
                            type="button"
                            className={`dashboard-schedule-sidebar-item${props.activeGroup === group.id ? ' is-active' : ''}`}
                            onClick={() => props.onGroupChange(group.id)}
                            aria-pressed={props.activeGroup === group.id}
                        >
                            <span>{group.label}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </nav>
    );
}

export type { ScheduleGroup };
export { GROUPS as SCHEDULE_GROUPS };

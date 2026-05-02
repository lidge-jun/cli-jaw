import type { DashboardInstance } from '../types';

type BoardLane = 'inbox' | 'doing' | 'blocked' | 'review' | 'done';

const LANES: { id: BoardLane; label: string }[] = [
    { id: 'inbox', label: 'Inbox' },
    { id: 'doing', label: 'Doing' },
    { id: 'blocked', label: 'Blocked' },
    { id: 'review', label: 'Review' },
    { id: 'done', label: 'Done' },
];

type Props = {
    activeLane: BoardLane;
    onLaneChange: (lane: BoardLane) => void;
    instances: DashboardInstance[];
    selectedPort: number | null;
};

export function DashboardBoardSidebar(props: Props) {
    const onlineCount = props.instances.filter(i => i.status === 'online').length;
    const countLabel = props.selectedPort !== null
        ? `:${props.selectedPort} focused`
        : `${onlineCount} online`;
    return (
        <nav className="dashboard-board-sidebar" aria-label="Board lanes">
            <header className="dashboard-board-sidebar-header">
                <span className="dashboard-board-sidebar-title">Board</span>
                <span className="dashboard-board-sidebar-count">{countLabel}</span>
            </header>
            <ul className="dashboard-board-sidebar-list">
                {LANES.map(lane => (
                    <li key={lane.id}>
                        <button
                            type="button"
                            className={`dashboard-board-sidebar-item${props.activeLane === lane.id ? ' is-active' : ''}`}
                            onClick={() => props.onLaneChange(lane.id)}
                            aria-pressed={props.activeLane === lane.id}
                        >
                            <span>{lane.label}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </nav>
    );
}

export type { BoardLane };
export { LANES as BOARD_LANES };

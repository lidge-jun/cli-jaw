import type { DashboardSidebarMode } from '../types';

type SidebarRailProps = {
    onlineCount: number;
    collapsed: boolean;
    mode: DashboardSidebarMode;
    onModeChange: (mode: DashboardSidebarMode) => void;
    onToggleSidebar: () => void;
};

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
    const points = direction === 'left' ? '11 4 5 10 11 16' : '5 4 11 10 5 16';
    return (
        <svg
            className="rail-collapse-chevron"
            viewBox="0 0 16 20"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            <polyline points={points} />
        </svg>
    );
}

function MonitorIcon() {
    return (
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <rect x="3" y="4" width="14" height="10" rx="1.5" />
            <path d="M8 17h4M10 14v3" />
        </svg>
    );
}

function NoteIcon() {
    return (
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M6 3h6l3 3v11H6z" />
            <path d="M12 3v4h3M8 10h5M8 13h5" />
        </svg>
    );
}

function SettingsIcon() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

export function SidebarRail(props: SidebarRailProps) {
    const expanded = !props.collapsed;
    const toggleLabel = expanded ? 'Collapse navigation' : 'Expand navigation';
    return (
        <div className="sidebar-rail">
            <button
                className="rail-collapse-button"
                type="button"
                onClick={props.onToggleSidebar}
                aria-label={toggleLabel}
                aria-expanded={expanded}
                aria-pressed={props.collapsed}
                aria-controls="manager-sidebar-list"
                title={toggleLabel}
            >
                <ChevronIcon direction={expanded ? 'left' : 'right'} />
            </button>
            <button
                className={`rail-button rail-workspace-button${props.mode === 'instances' ? ' is-active' : ''}`}
                type="button"
                onClick={() => props.onModeChange('instances')}
                aria-label="Instances"
                aria-pressed={props.mode === 'instances'}
                title="Instances"
            >
                <MonitorIcon />
            </button>
            <button
                className={`rail-button rail-workspace-button${props.mode === 'notes' ? ' is-active' : ''}`}
                type="button"
                onClick={() => props.onModeChange('notes')}
                aria-label="Notes"
                aria-pressed={props.mode === 'notes'}
                title="Notes"
            >
                <NoteIcon />
            </button>
            <button
                className={`rail-button rail-workspace-button${props.mode === 'settings' ? ' is-active' : ''}`}
                type="button"
                onClick={() => props.onModeChange('settings')}
                aria-label="Dashboard settings"
                aria-pressed={props.mode === 'settings'}
                title="Dashboard settings"
            >
                <SettingsIcon />
            </button>
            <div className="rail-spacer" />
            <span className="rail-status-dot" aria-label={`${props.onlineCount} online instances`} />
        </div>
    );
}

type DashboardSettingsSection = 'display' | 'activity';

type DashboardSettingsSidebarProps = {
    activeSection: DashboardSettingsSection;
    onSectionChange: (section: DashboardSettingsSection) => void;
};

const SECTIONS: Array<{ id: DashboardSettingsSection; label: string; hint: string }> = [
    { id: 'display', label: 'Sidebar rows', hint: 'Density and inline controls' },
    { id: 'activity', label: 'Preview & activity', hint: 'Title source and defaults' },
];

export function DashboardSettingsSidebar(props: DashboardSettingsSidebarProps) {
    return (
        <nav className="dashboard-settings-sidebar" aria-label="Dashboard settings sections">
            <div className="dashboard-settings-sidebar-header">
                <span className="eyebrow">Dashboard</span>
                <strong>Settings</strong>
            </div>
            <div className="dashboard-settings-sidebar-list">
                {SECTIONS.map(section => (
                    <button
                        key={section.id}
                        className={`dashboard-settings-sidebar-button${props.activeSection === section.id ? ' is-active' : ''}`}
                        type="button"
                        aria-pressed={props.activeSection === section.id}
                        onClick={() => props.onSectionChange(section.id)}
                    >
                        <span>{section.label}</span>
                        <small>{section.hint}</small>
                    </button>
                ))}
            </div>
        </nav>
    );
}

export type { DashboardSettingsSection };

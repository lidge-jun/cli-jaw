import type { SettingsCategoryId, SettingsCategoryGroup } from './types';

type SidebarEntry = {
    id: SettingsCategoryId;
    label: string;
    group: SettingsCategoryGroup;
};

const CATEGORIES: SidebarEntry[] = [
    { id: 'identity-preview', label: 'Identity (preview)', group: 'core' },
    // Phases 2–9 will register their entries here.
];

type Props = {
    activeId: SettingsCategoryId;
    onSelect: (id: SettingsCategoryId) => void;
};

export function SettingsSidebar({ activeId, onSelect }: Props) {
    return (
        <nav className="settings-sidebar" aria-label="Settings categories">
            {CATEGORIES.map((c) => (
                <button
                    key={c.id}
                    type="button"
                    className={`settings-sidebar-item${c.id === activeId ? ' is-active' : ''}`}
                    onClick={() => onSelect(c.id)}
                >
                    {c.label}
                </button>
            ))}
        </nav>
    );
}

export const SETTINGS_CATEGORIES: ReadonlyArray<SidebarEntry> = CATEGORIES;

import { useCallback, useState } from 'react';
import type { DashboardRegistryUi } from '../types';
import { DEFAULT_MANAGER_SHORTCUT_KEYMAP, normalizeManagerShortcutKeymap } from '../manager-shortcuts';
import type { DashboardDetailTab, DashboardDiffMode, DashboardDiffRootPolicy, DashboardLocale, DashboardNotesAuthoringMode, DashboardNotesGraphSettings, DashboardNotesViewMode, DashboardShortcutKeymap, DashboardSidebarMode, DashboardViewMode } from '../types';

export function useDashboardView() {
    const [selectedPort, setSelectedPort] = useState<number | null>(null);
    const [activeDetailTab, setActiveDetailTab] = useState<DashboardDetailTab>('overview');
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [activityDockCollapsed, setActivityDockCollapsed] = useState(false);
    const [activityDockHeight, setActivityDockHeight] = useState(150);
    const [sidebarMode, setSidebarMode] = useState<DashboardSidebarMode>('instances');
    const [viewMode, setViewMode] = useState<DashboardViewMode>('jaw');
    const [notesSelectedPath, setNotesSelectedPath] = useState<string | null>(null);
    const [notesViewMode, setNotesViewMode] = useState<DashboardNotesViewMode>('raw');
    const [notesAuthoringMode, setNotesAuthoringMode] = useState<DashboardNotesAuthoringMode>('plain');
    const [notesWordWrap, setNotesWordWrap] = useState(true);
    const [notesVimMode, setNotesVimMode] = useState(false);
    const [notesTreeWidth, setNotesTreeWidth] = useState(280);
    const [notesGraphSettings, setNotesGraphSettings] = useState<DashboardNotesGraphSettings | undefined>(undefined);
    const [showLatestActivityTitles, setShowLatestActivityTitles] = useState(true);
    const [showInlineLabelEditor, setShowInlineLabelEditor] = useState(true);
    const [showSidebarRuntimeLine, setShowSidebarRuntimeLine] = useState(true);
    const [showSelectedRowActions, setShowSelectedRowActions] = useState(true);
    const [dashboardShortcutsEnabled, setDashboardShortcutsEnabled] = useState(true);
    const [dashboardShortcutKeymap, setDashboardShortcutKeymapState] = useState<DashboardShortcutKeymap>({ ...DEFAULT_MANAGER_SHORTCUT_KEYMAP });
    const [diffRootPolicy, setDiffRootPolicy] = useState<DashboardDiffRootPolicy>('project-first');
    const [diffPinnedRootByPort, setDiffPinnedRootByPort] = useState<Record<string, string>>({});
    const [diffRecentRepoRoots, setDiffRecentRepoRoots] = useState<string[]>([]);
    const [diffDefaultMode, setDiffDefaultMode] = useState<DashboardDiffMode>('unstaged');
    const [diffBaseRef, setDiffBaseRef] = useState('HEAD');
    const [diffIncludeUntracked, setDiffIncludeUntracked] = useState(true);
    const [rightFolderRootPath, setRightFolderRootPath] = useState<string | null>(null);
    const [locale, setLocale] = useState<DashboardLocale>('ko');

    function setDashboardShortcutKeymap(value: unknown): void {
        setDashboardShortcutKeymapState(normalizeManagerShortcutKeymap(value));
    }

    return {
        selectedPort,
        setSelectedPort,
        activeDetailTab,
        setActiveDetailTab,
        drawerOpen,
        setDrawerOpen,
        sidebarCollapsed,
        setSidebarCollapsed,
        activityDockCollapsed,
        setActivityDockCollapsed,
        activityDockHeight,
        setActivityDockHeight,
        sidebarMode,
        setSidebarMode,
        viewMode,
        setViewMode,
        notesSelectedPath,
        setNotesSelectedPath,
        notesViewMode,
        setNotesViewMode,
        notesAuthoringMode,
        setNotesAuthoringMode,
        notesWordWrap,
        setNotesWordWrap,
        notesVimMode,
        setNotesVimMode,
        notesTreeWidth,
        setNotesTreeWidth,
        notesGraphSettings,
        setNotesGraphSettings,
        showLatestActivityTitles,
        setShowLatestActivityTitles,
        showInlineLabelEditor,
        setShowInlineLabelEditor,
        showSidebarRuntimeLine,
        setShowSidebarRuntimeLine,
        showSelectedRowActions,
        setShowSelectedRowActions,
        dashboardShortcutsEnabled,
        setDashboardShortcutsEnabled,
        dashboardShortcutKeymap,
        setDashboardShortcutKeymap,
        diffRootPolicy,
        setDiffRootPolicy,
        diffPinnedRootByPort,
        setDiffPinnedRootByPort,
        diffRecentRepoRoots,
        setDiffRecentRepoRoots,
        diffDefaultMode,
        setDiffDefaultMode,
        diffBaseRef,
        setDiffBaseRef,
        diffIncludeUntracked,
        setDiffIncludeUntracked,
        rightFolderRootPath,
        setRightFolderRootPath,
        locale,
        setLocale,
    };
}

/**
 * The in-Workbench instance settings panel is gone; the rail owns settings now. A registry
 * written by an older client can still carry `instanceSettingsOpen: true` or the retired
 * `selectedTab: 'settings'`, so map either onto the rail's sidebar mode rather than dropping
 * the user on a workspace whose settings tab no longer exists. The field stays accepted by
 * the server normalizer for one version; nothing writes it any more.
 */
export function hydrateInstanceSettings(ui: Pick<DashboardRegistryUi, 'selectedTab' | 'sidebarMode'> & { instanceSettingsOpen?: unknown }) {
    const legacySettingsRequest = ui.selectedTab === 'settings' || ui.instanceSettingsOpen === true;
    return { selectedTab: ui.selectedTab === 'settings' ? 'overview' as const : ui.selectedTab,
        sidebarMode: legacySettingsRequest ? 'settings' as const : ui.sidebarMode };
}

type SettingsNavigation = {
    view: Pick<ReturnType<typeof useDashboardView>, 'activeDetailTab' | 'sidebarMode' |
        'setSelectedPort' | 'setSidebarMode' | 'setViewMode' | 'setDrawerOpen'>;
    selectedPort: number | null;
    settingsDirty: boolean;
    dashboardSettingsDirty: boolean;
    clearDirty: (entry: 'dashboard') => void;
    saveUi: (patch: Partial<DashboardRegistryUi>) => Promise<void>;
    confirmDiscard?: () => boolean;
};
export function createInstanceSettingsNavigation(args: SettingsNavigation) {
    const { view, selectedPort } = args;
    function canLeaveDirtySettings(): boolean {
        return !args.settingsDirty ||
            (args.confirmDiscard ?? (() => window.confirm('Discard unsaved Settings changes?')))();
    }
    function guardSettingsTransition(target: Partial<{
        sidebarMode: DashboardSidebarMode; selectedPort: number | null;
    }>): boolean {
        const portChanged = target.selectedPort !== undefined && target.selectedPort !== selectedPort;
        const leavingDashboard = view.sidebarMode === 'settings' && (target.sidebarMode ?? view.sidebarMode) !== 'settings';
        // The rail workspace is the only settings surface, so there is one draft to guard.
        const departing = portChanged || leavingDashboard;
        if (!departing) return true;
        if (args.dashboardSettingsDirty
            && !(args.confirmDiscard ?? (() => window.confirm('Discard unsaved Settings changes?')))()) return false;
        args.clearDirty('dashboard');
        return true;
    }
    /** Opens or closes the rail's manager settings workspace, honouring the dirty guard. */
    function setDashboardSettingsOpen(open: boolean): void {
        const sidebarMode = open ? 'settings' as const : 'instances' as const;
        if (view.sidebarMode === sidebarMode) return;
        if (!guardSettingsTransition({ sidebarMode })) return;
        if (open) { view.setViewMode('jaw'); view.setDrawerOpen(false); }
        view.setSidebarMode(sidebarMode);
        void args.saveUi({ sidebarMode,
            selectedTab: view.activeDetailTab === 'settings' ? 'overview' : view.activeDetailTab });
    }
    return { canLeaveDirtySettings, guardSettingsTransition, setDashboardSettingsOpen };
}

// One settings surface remains, so there is one draft. The entry name is kept so the
// dirty-store call sites read the same as before.
export function settingsDirtyAfter(current: { dashboard: boolean },
    entry: 'dashboard', dirty: boolean) {
    return { ...current, [entry]: dirty };
}
export function useSettingsDirtyState() {
    const [entries, setEntries] = useState({ dashboard: false });
    const onSettingsDirtyChange = useCallback((entry: 'dashboard', dirty: boolean) => {
        setEntries(current => settingsDirtyAfter(current, entry, dirty));
    }, []);
    const setSettingsDirty = useCallback((dirty: boolean) => {
        setEntries({ dashboard: dirty });
    }, []);
    return { settingsDirty: entries.dashboard, dashboardSettingsDirty: entries.dashboard, setSettingsDirty, onSettingsDirtyChange };
}

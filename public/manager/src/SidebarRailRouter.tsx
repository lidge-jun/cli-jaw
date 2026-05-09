import { useState, type ReactNode } from 'react';
import { ActivityDock } from './components/ActivityDock';
import { InstanceDrawer } from './components/InstanceDrawer';
import { InstanceNavigator } from './components/InstanceNavigator';
import { MobileNav } from './components/MobileNav';
import { SidebarRail } from './components/SidebarRail';
import { Workbench } from './components/Workbench';
import { WorkspaceLayout } from './components/WorkspaceLayout';
import { InstancePreview } from './InstancePreview';
import { DashboardSettingsSidebar, type DashboardSettingsSection } from './dashboard-settings/DashboardSettingsSidebar';
import { DashboardSettingsWorkspace } from './dashboard-settings/DashboardSettingsWorkspace';
import { NotesSidebar, type NotesSidebarMode } from './notes/NotesSidebar';
import { NotesWorkspace } from './notes/NotesWorkspace';
import { DashboardBoardSidebar } from './dashboard-board/DashboardBoardSidebar';
import { DashboardBoardWorkspace } from './dashboard-board/DashboardBoardWorkspace';
import type { BoardView } from './dashboard-board/board-view';
import { DashboardScheduleSidebar, type ScheduleGroup } from './dashboard-schedule/DashboardScheduleSidebar';
import { DashboardScheduleWorkspace } from './dashboard-schedule/DashboardScheduleWorkspace';
import { DashboardRemindersSidebar, type RemindersView } from './dashboard-reminders/DashboardRemindersSidebar';
import { DashboardRemindersWorkspace } from './dashboard-reminders/DashboardRemindersWorkspace';
import { useRemindersFeed } from './dashboard-reminders/useRemindersFeed';
import type { NotesModelState } from './notes/useNotesModel';
import type {
    DashboardDetailTab,
    DashboardInstance,
    DashboardNotesAuthoringMode,
    DashboardNotesViewMode,
    DashboardScanResult,
    DashboardSidebarMode,
    NoteMetadata,
    DashboardLocale,
    ManagerEvent,
} from './types';

type WorkspaceSurfaceProps = {
    active: boolean;
    children: ReactNode;
};

function WorkspaceSurface(props: WorkspaceSurfaceProps) {
    return <section className={`workspace-surface${props.active ? ' is-active' : ''}`} hidden={!props.active} aria-hidden={!props.active}>{props.children}</section>;
}

type Props = {
    sidebarCollapsed: boolean;
    activityDockCollapsed: boolean;
    activityDockHeight: number;
    drawerOpen: boolean;
    onCloseDrawer: () => void;
    onlineCount: number;
    sidebarMode: DashboardSidebarMode;
    scheduleWorkspaceEnabled: boolean;
    remindersWorkspaceEnabled: boolean;
    onSidebarModeChange: (mode: DashboardSidebarMode) => void;
    onToggleSidebar: () => void;
    helpOpen: boolean;
    onToggleHelp: () => void;
    settingsSection: DashboardSettingsSection;
    locale: DashboardLocale;
    onSettingsSectionChange: (section: DashboardSettingsSection) => void;
    notesModel: NotesModelState;
    notesSelectedPath: string | null;
    notesSelectedNote: NoteMetadata | null;
    notesDirtyPath: string | null;
    notesTreeWidth: number;
    notesSidebarMode: NotesSidebarMode;
    notesSearchFocusToken: number;
    notesViewMode: DashboardNotesViewMode;
    notesAuthoringMode: DashboardNotesAuthoringMode;
    notesWordWrap: boolean;
    onNotesSidebarModeChange: (mode: NotesSidebarMode) => void;
    onOpenNotesSearch: () => void;
    onNotesSelectedPathChange: (path: string | null) => void;
    onNotesDirtyPathChange: (path: string | null) => void;
    onNotesViewModeChange: (mode: DashboardNotesViewMode) => void;
    onNotesAuthoringModeChange: (mode: DashboardNotesAuthoringMode) => void;
    onNotesWordWrapChange: (value: boolean) => void;
    onNotesTreeWidthChange: (value: number) => void;
    boardView: BoardView;
    onBoardViewChange: (view: BoardView) => void;
    scheduleGroup: ScheduleGroup;
    onScheduleGroupChange: (group: ScheduleGroup) => void;
    instances: DashboardInstance[];
    selectedInstance: DashboardInstance | null;
    data: DashboardScanResult | null;
    titlesByPort: Record<number, string>;
    busyPorts: Set<number>;
    activeDetailTab: DashboardDetailTab;
    onDetailTabChange: (tab: DashboardDetailTab) => void;
    workbenchHeader: ReactNode;
    detailContent: (tab: DashboardDetailTab) => ReactNode;
    previewEnabled: boolean;
    previewRefreshKey: number;
    previewTheme: 'dark' | 'light';
    lifecycleMessage: string | null;
    onDismissLifecycleMessage: () => void;
    instanceListContent: ReactNode;
    loading: boolean;
    error: string | null;
    registryMessage: string | null;
    managerEvents: ManagerEvent[];
    onToggleActivity: () => void;
    onActivityHeightChange: (height: number) => void;
    onOpenDrawer: () => void;
    onSelectTab: (tab: DashboardDetailTab) => void;
    onToggleActivityFromMobile: () => void;
    drawerProfileFilters: ReactNode;
    dashboardSettingsUi: Parameters<typeof DashboardSettingsWorkspace>[0]['ui'];
    titleSupport: Parameters<typeof DashboardSettingsWorkspace>[0]['titleSupport'];
    onDashboardSettingsPatch: Parameters<typeof DashboardSettingsWorkspace>[0]['onUiPatch'];
};

export function SidebarRailRouter(props: Props) {
    const [remindersView, setRemindersView] = useState<RemindersView>('matrix');
    const remindersFeed = useRemindersFeed({ active: props.sidebarMode === 'reminders' });
    const notesSelectedHiddenByFilter = Boolean(
        props.notesModel.tagFilter
        && props.notesSelectedPath
        && props.notesSelectedNote
        && !props.notesSelectedNote.tags?.includes(props.notesModel.tagFilter),
    );

    return (
        <WorkspaceLayout
            sidebarCollapsed={props.sidebarCollapsed}
            inspectorCollapsed={props.activityDockCollapsed}
            inspectorHeight={props.activityDockCollapsed ? 48 : props.activityDockHeight}
            drawerOpen={props.drawerOpen}
            onCloseDrawer={props.onCloseDrawer}
            navigator={(
                <>
                    <SidebarRail
                        onlineCount={props.onlineCount}
                        collapsed={props.sidebarCollapsed}
                        mode={props.sidebarMode}
                        scheduleWorkspaceEnabled={props.scheduleWorkspaceEnabled}
                        remindersWorkspaceEnabled={props.remindersWorkspaceEnabled}
                        onModeChange={props.onSidebarModeChange}
                        onToggleSidebar={props.onToggleSidebar}
                        helpOpen={props.helpOpen}
                        onToggleHelp={props.onToggleHelp}
                    />
                    <div id="manager-sidebar-list" className="manager-sidebar-list">
                        {props.sidebarMode === 'settings' ? (
                            <DashboardSettingsSidebar activeSection={props.settingsSection} locale={props.locale} onSectionChange={props.onSettingsSectionChange} />
                        ) : props.sidebarMode === 'notes' ? (
                            <NotesSidebar tree={props.notesModel.filteredTree} loading={props.notesModel.loading} error={props.notesModel.error} notesRoot={props.notesModel.notesRoot} selectedPath={props.notesSelectedPath} dirtyPath={props.notesDirtyPath} treeWidth={props.notesTreeWidth} mode={props.notesSidebarMode} searchFocusToken={props.notesSearchFocusToken} tagFilter={props.notesModel.tagFilter} selectedHiddenByFilter={notesSelectedHiddenByFilter} onModeChange={props.onNotesSidebarModeChange} onOpenSearch={props.onOpenNotesSearch} onSelectedPathChange={props.onNotesSelectedPathChange} onRefreshTree={props.notesModel.refresh} onClearTagFilter={() => props.notesModel.setTagFilter(null)} />
                        ) : props.sidebarMode === 'board' ? (
                            <DashboardBoardSidebar view={props.boardView} onViewChange={props.onBoardViewChange} instances={props.instances} titlesByPort={props.titlesByPort} busyPorts={props.busyPorts} />
                        ) : props.scheduleWorkspaceEnabled && props.sidebarMode === 'schedule' ? (
                            <DashboardScheduleSidebar activeGroup={props.scheduleGroup} onGroupChange={props.onScheduleGroupChange} />
                        ) : props.remindersWorkspaceEnabled && props.sidebarMode === 'reminders' ? (
                            <DashboardRemindersSidebar view={remindersView} onViewChange={setRemindersView} items={remindersFeed.items} loading={remindersFeed.loading} onRefresh={() => void remindersFeed.refresh()} />
                        ) : (
                            <InstanceNavigator active={props.selectedInstance} hiddenCount={props.instances.filter(instance => instance.hidden).length} collapsed={props.sidebarCollapsed}>
                                {props.instanceListContent}
                            </InstanceNavigator>
                        )}
                    </div>
                </>
            )}
            workbench={(
                <div className="workspace-surface-stack">
                    {props.lifecycleMessage && (
                        <section className="state lifecycle-state" role="status">
                            <span>{props.lifecycleMessage}</span>
                            <button type="button" className="state-dismiss" aria-label="Dismiss lifecycle message" onClick={props.onDismissLifecycleMessage}>X</button>
                        </section>
                    )}
                    <div className="workspace-surface-layer">
                        <WorkspaceSurface active={props.sidebarMode === 'instances'}>
                            <Workbench mode={props.activeDetailTab} onModeChange={props.onDetailTabChange} header={props.workbenchHeader} overview={props.detailContent('overview')} preview={(
                                <InstancePreview instance={props.selectedInstance} data={props.data} enabled={props.previewEnabled} refreshKey={props.previewRefreshKey} theme={props.previewTheme} />
                            )} logs={props.detailContent('logs')} settings={props.detailContent('settings')} />
                        </WorkspaceSurface>
                        <WorkspaceSurface active={props.sidebarMode === 'notes'}>
                            <NotesWorkspace active={props.sidebarMode === 'notes'} selectedPath={props.notesSelectedPath} selectedNote={props.notesSelectedNote} vaultIndex={props.notesModel.index} viewMode={props.notesViewMode} authoringMode={props.notesAuthoringMode} wordWrap={props.notesWordWrap} treeWidth={props.notesTreeWidth} tagFilter={props.notesModel.tagFilter} onOpenSidebarSearch={props.onOpenNotesSearch} onSelectedPathChange={props.onNotesSelectedPathChange} onDirtyPathChange={props.onNotesDirtyPathChange} onViewModeChange={props.onNotesViewModeChange} onAuthoringModeChange={props.onNotesAuthoringModeChange} onWordWrapChange={props.onNotesWordWrapChange} onTreeWidthChange={props.onNotesTreeWidthChange} onTagSelect={props.notesModel.setTagFilter} onWikiLinkNavigate={props.onNotesSelectedPathChange} />
                        </WorkspaceSurface>
                        <WorkspaceSurface active={props.sidebarMode === 'settings'}>
                            <DashboardSettingsWorkspace activeSection={props.settingsSection} ui={props.dashboardSettingsUi} titleSupport={props.titleSupport} onUiPatch={props.onDashboardSettingsPatch} />
                        </WorkspaceSurface>
                        <WorkspaceSurface active={props.sidebarMode === 'board'}>
                            <DashboardBoardWorkspace active={props.sidebarMode === 'board'} view={props.boardView} onViewChange={props.onBoardViewChange} instances={props.instances} selectedPort={props.selectedInstance?.port ?? null} titlesByPort={props.titlesByPort} busyPorts={props.busyPorts} />
                        </WorkspaceSurface>
                        {props.scheduleWorkspaceEnabled ? (
                            <WorkspaceSurface active={props.sidebarMode === 'schedule'}>
                                <DashboardScheduleWorkspace active={props.sidebarMode === 'schedule'} activeGroup={props.scheduleGroup} busyPorts={props.busyPorts} />
                            </WorkspaceSurface>
                        ) : null}
                        {props.remindersWorkspaceEnabled ? (
                            <WorkspaceSurface active={props.sidebarMode === 'reminders'}>
                                <DashboardRemindersWorkspace active={props.sidebarMode === 'reminders'} view={remindersView} feed={remindersFeed} onRefresh={() => void remindersFeed.refresh()} onCreate={(input) => void remindersFeed.create(input)} onUpdate={(id, patch) => void remindersFeed.update(id, patch)} />
                            </WorkspaceSurface>
                        ) : null}
                    </div>
                </div>
            )}
            inspector={(
                <ActivityDock
                    collapsed={props.activityDockCollapsed}
                    height={props.activityDockHeight}
                    loading={props.loading}
                    error={props.error}
                    lifecycleMessage={props.lifecycleMessage}
                    selectedInstance={props.selectedInstance}
                    registryMessage={props.registryMessage}
                    events={props.managerEvents}
                    onToggle={props.onToggleActivity}
                    onHeightChange={props.onActivityHeightChange}
                />
            )}
            mobileNav={<MobileNav activeTab={props.activeDetailTab} onOpenInstances={props.onOpenDrawer} onSelectTab={props.onSelectTab} onToggleActivity={props.onToggleActivityFromMobile} />}
            drawer={(
                <InstanceDrawer open={props.drawerOpen} profileFilters={props.drawerProfileFilters} onClose={props.onCloseDrawer}>
                    {props.instanceListContent}
                </InstanceDrawer>
            )}
        />
    );
}

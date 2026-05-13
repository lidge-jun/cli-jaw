import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchInstances, fetchInstanceStatus, runLifecycleAction } from './api';
import { pollUntilSettled } from './lifecycle-poll';
import { InstanceDetailPanel } from './components/InstanceDetailPanel';
import { InstanceListContent } from './components/InstanceListContent';
import { ProfileChip } from './components/ProfileChip';
import { AppChrome } from './AppChrome';
import { type HelpTopicId } from './help/helpContent';
import { isHelpShortcutEditableTarget } from './help/help-shortcuts';
import { WorkbenchHeader } from './components/WorkbenchHeader';
import { loadPreviewEnabled, savePreviewEnabled } from './lib/preview-prefs';
import { useHiddenUnload } from './lib/use-hidden-unload';
import { type DashboardSettingsSection } from './dashboard-settings/DashboardSettingsSidebar';
import { summarizeActivityTitleSupport } from './dashboard-settings/activity-title-support';
import { dashboardSettingsUiFromView } from './dashboard-settings/dashboard-settings-ui';
import { type NotesSidebarMode } from './notes/NotesSidebar';
import { useNotesModel } from './notes/useNotesModel';
import { publishInvalidation } from './sync/invalidation-bus';
import { useInvalidationSubscription } from './sync/useInvalidationSubscription';
import type { BoardView } from './dashboard-board/board-view';
import { type ScheduleGroup } from './dashboard-schedule/DashboardScheduleSidebar';
import { normalizeSidebarModeForBuild } from './dashboard-features';
import { readInitialSidebarMode } from './dashboard-url-state';
import { useDashboardRegistry } from './hooks/useDashboardRegistry';
import { useDashboardView } from './hooks/useDashboardView';
import { useActivityUnread } from './hooks/useActivityUnread';
import { useTheme } from './hooks/useTheme';
import { useCommandPalette } from './hooks/useCommandPalette';
import { useInstanceLabelEditor } from './hooks/useInstanceLabelEditor';
import { useInstanceMessageEvents } from './hooks/useInstanceMessageEvents';
import { useManagerEvents } from './hooks/useManagerEvents';
import { formatUptime, instanceLabel } from './instance-label';
import { useJawCeoDashboardBridge } from './jaw-ceo/useJawCeoDashboardBridge';
import { actionForShortcutEvent, isManagerShortcutEditableTarget } from './manager-shortcuts';
import { reconcileActiveProfileFilter } from './profile-filter';
import type { DashboardDetailTab, DashboardInstance, DashboardInstanceStatus, DashboardLifecycleAction, DashboardNotesAuthoringMode, DashboardNotesViewMode, DashboardProfile, DashboardScanResult, DashboardShortcutAction, DashboardSidebarMode } from './types';

export function App() {
    const [data, setData] = useState<DashboardScanResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<'all' | DashboardInstanceStatus>('all');
    const [customHome, setCustomHome] = useState('');
    const [showHidden, setShowHidden] = useState(false);
    const [hydrated, setHydrated] = useState(false);
    const [lifecycleBusyPort, setLifecycleBusyPort] = useState<number | null>(null);
    const [lifecycleMessage, setLifecycleMessage] = useState<string | null>(null);
    const [transitioningPort, setTransitioningPort] = useState<number | null>(null);
    const [transitionAction, setTransitionAction] = useState<DashboardLifecycleAction | null>(null);
    const [activeProfileIds, setActiveProfileIds] = useState<string[]>([]);
    const [settingsDirty, setSettingsDirty] = useState(false);
    const [notesDirtyPath, setNotesDirtyPath] = useState<string | null>(null);
    const [notesSidebarMode, setNotesSidebarMode] = useState<NotesSidebarMode>('files');
    const [notesSearchFocusToken, setNotesSearchFocusToken] = useState(0);
    const [dashboardSettingsSection, setDashboardSettingsSection] = useState<DashboardSettingsSection>('display');
    const [boardView, setBoardView] = useState<BoardView>({ kind: 'overall' });
    const [scheduleGroup, setScheduleGroup] = useState<ScheduleGroup>('today');
    const [previewEnabled, setPreviewEnabled] = useState<boolean>(() => loadPreviewEnabled());
    const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
    const [autoUnloadNotice, setAutoUnloadNotice] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [helpTopic, setHelpTopic] = useState<HelpTopicId | null>(null);
    const openHelpTopic = useCallback((topic: HelpTopicId) => {
        setHelpTopic(topic);
        setHelpOpen(true);
    }, []);
    useEffect(() => {
        savePreviewEnabled(previewEnabled);
    }, [previewEnabled]);
    useHiddenUnload({ enabled: previewEnabled, onUnload: () => { setPreviewEnabled(false); setAutoUnloadNotice(true); } });
    useEffect(() => {
        if (!autoUnloadNotice) return undefined;
        if (typeof document === 'undefined') return undefined;
        if (document.hidden) return undefined;
        const timer = setTimeout(() => setAutoUnloadNotice(false), 8000);
        return () => clearTimeout(timer);
    }, [autoUnloadNotice]);
    const registry = useDashboardRegistry();
    const view = useDashboardView();
    const theme = useTheme((next) => {
        if (!hydrated) return;
        void registry.save({ ui: { uiTheme: next } });
    });
    const palette = useCommandPalette();
    const managerEvents = useManagerEvents();
    const instances = data?.instances || [];
    const messageActivity = useInstanceMessageEvents(instances);
    const labelEditor = useInstanceLabelEditor(registry.save, setData);

    const profiles = useMemo(() => data?.manager.profiles || [], [data]);
    const effectiveProfileIds = useMemo(() => {
        const known = new Set(profiles.map(profile => profile.profileId));
        return activeProfileIds.filter(profileId => known.has(profileId));
    }, [activeProfileIds, profiles]);
    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return instances.filter((instance) => {
            if (status !== 'all' && instance.status !== status) return false;
            if (effectiveProfileIds.length > 0 && (!instance.profileId || !effectiveProfileIds.includes(instance.profileId))) return false;
            if (!needle) return true;
            return [
                String(instance.port),
                instance.url,
                instanceLabel(instance),
                instance.version,
                instance.workingDir,
                instance.currentCli,
                instance.currentModel,
                instance.healthReason,
                instance.label,
                instance.group,
                instance.profileId,
            ].some(value => String(value || '').toLowerCase().includes(needle));
        });
    }, [effectiveProfileIds, instances, query, status]);
    const selectedInstance = useMemo(() => {
        if (view.selectedPort == null) return filtered.find(instance => instance.ok) || null;
        return instances.find(instance => instance.port === view.selectedPort) || null;
    }, [filtered, instances, view.selectedPort]);
    const activeJawCeoPort = selectedInstance?.port ?? view.selectedPort ?? null;
    const jawCeoBridge = useJawCeoDashboardBridge({ selectedPort: activeJawCeoPort, managerEvents: managerEvents.events, messageEvents: messageActivity.events, onOpenWorker: handleOpenJawCeoWorker });
    const activePreviewPort = view.activeDetailTab === 'preview' && view.sidebarMode === 'instances'
        ? (selectedInstance?.port ?? null)
        : null;
    const activityEvents = useMemo(() => {
        return [...managerEvents.events, ...messageActivity.events];
    }, [managerEvents.events, messageActivity.events]);
    const activityUnread = useActivityUnread({
        events: activityEvents,
        activityDockCollapsed: view.activityDockCollapsed,
        setActivityDockCollapsed: view.setActivityDockCollapsed,
        saveUi,
        activePreviewPort,
    });
    function cycleTheme(): void {
        const order: ('auto' | 'light' | 'dark')[] = ['auto', 'light', 'dark'];
        const next = order[(order.indexOf(theme.theme) + 1) % order.length];
        theme.setTheme(next);
    }
    function openSelectedInBrowser(): void {
        if (!selectedInstance) return;
        window.open(selectedInstance.url, '_blank', 'noopener,noreferrer');
    }
    useEffect(() => { document.documentElement.lang = view.locale; }, [view.locale]);

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent): void {
            if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) return;
            if (isHelpShortcutEditableTarget(event.target)) return;
            event.preventDefault(); openHelpTopic('shortcuts');
        }
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [openHelpTopic]);

    async function load(nextShowHidden = showHidden): Promise<void> {
        setLoading(true);
        setError(null);
        try {
            const result = await fetchInstances(nextShowHidden);
            const nextProfileIds = reconcileActiveProfileFilter(activeProfileIds, result.manager.profiles || []);
            if (nextProfileIds !== activeProfileIds) { setActiveProfileIds(nextProfileIds); void registry.save({ activeProfileFilter: nextProfileIds }); }
            setData(result);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    }

    async function refreshInstance(port: number): Promise<void> {
        const instance = await fetchInstanceStatus(port);
        if (!instance) return;
        setData((current) => current ? {
            ...current,
            instances: current.instances.map(row => row.port === port ? instance : row),
        } : current);
    }

    useInvalidationSubscription('instances', () => void load(), 'app');

    useEffect(() => {
        async function initialize(): Promise<void> {
            try {
                const loaded = await registry.refresh();
                const ui = loaded.registry.ui;
                view.setSelectedPort(ui.selectedPort);
                view.setActiveDetailTab(ui.selectedTab);
                view.setSidebarCollapsed(ui.sidebarCollapsed);
                view.setActivityDockCollapsed(ui.activityDockCollapsed);
                view.setActivityDockHeight(ui.activityDockHeight);
                const sidebarMode = normalizeSidebarModeForBuild(readInitialSidebarMode(window.location.search) ?? ui.sidebarMode);
                view.setSidebarMode(sidebarMode);
                if (sidebarMode !== ui.sidebarMode) void saveUi({ sidebarMode });
                view.setNotesSelectedPath(ui.notesSelectedPath);
                view.setNotesViewMode(ui.notesViewMode);
                view.setNotesAuthoringMode(ui.notesAuthoringMode ?? 'plain');
                view.setNotesWordWrap(ui.notesWordWrap);
                view.setNotesTreeWidth(ui.notesTreeWidth);
                view.setShowLatestActivityTitles(ui.showLatestActivityTitles);
                view.setShowInlineLabelEditor(ui.showInlineLabelEditor);
                view.setShowSidebarRuntimeLine(ui.showSidebarRuntimeLine);
                view.setShowSelectedRowActions(ui.showSelectedRowActions);
                view.setDashboardShortcutsEnabled(ui.dashboardShortcutsEnabled);
                view.setDashboardShortcutKeymap(ui.dashboardShortcutKeymap);
                view.setLocale(ui.locale);
                activityUnread.hydrateSeenAt(ui.activitySeenAt ?? null, ui.activitySeenByPort || {});
                setActiveProfileIds(loaded.registry.activeProfileFilter || []);
                theme.syncFromRegistry(ui.uiTheme);
            } finally {
                setHydrated(true);
                await load();
            }
        }
        void initialize();
    }, []);

    async function saveUi(ui: Parameters<typeof registry.save>[0]['ui']): Promise<void> {
        if (!hydrated || ui === undefined) return;
        await registry.save({ ui });
    }

    const profileCounts = useMemo(() => {
        return instances.reduce((acc, instance) => {
            if (instance.profileId) acc[instance.profileId] = (acc[instance.profileId] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
    }, [instances]);
    const summary = useMemo(() => {
        return instances.reduce((acc, instance) => {
            acc['total'] += 1;
            acc[instance.status] = (acc[instance.status] || 0) + 1;
            return acc;
        }, { total: 0 } as Record<string, number>);
    }, [instances]);

    function toggleProfile(profileId: string): void {
        const next = activeProfileIds.includes(profileId)
            ? activeProfileIds.filter(id => id !== profileId)
            : [...activeProfileIds, profileId];
        setActiveProfileIds(next);
        void registry.save({ activeProfileFilter: next });
    }

    function canLeaveDirtySettings(): boolean {
        if (view.activeDetailTab !== 'settings' || !settingsDirty) return true;
        return window.confirm('Discard unsaved Settings changes?');
    }

    function handlePreview(instance: DashboardInstance): void {
        if (!canLeaveDirtySettings()) return;
        setSettingsDirty(false);
        activityUnread.markPortSeen(instance.port);
        view.setSelectedPort(instance.port);
        view.setActiveDetailTab('preview');
        view.setActivityDockCollapsed(true);
        view.setDrawerOpen(false);
        void saveUi({ selectedPort: instance.port, selectedTab: 'preview', activityDockCollapsed: true });
    }

    function handleOpenJawCeoWorker(port: number): void { const instance = instances.find(row => row.port === port); if (instance) handlePreview(instance); }

    function handleSelectInstance(instance: DashboardInstance): void {
        if (!canLeaveDirtySettings()) return;
        setSettingsDirty(false);
        activityUnread.markPortSeen(instance.port);
        view.setSelectedPort(instance.port);
        view.setDrawerOpen(false);
        void saveUi({ selectedPort: instance.port });
    }

    function handleTabChange(tab: DashboardDetailTab): void {
        if (tab !== 'settings' && !canLeaveDirtySettings()) return;
        if (tab !== 'settings') setSettingsDirty(false);
        if (view.activeDetailTab === 'preview' && tab !== 'preview') {
            const port = view.selectedPort;
            if (port != null) activityUnread.markPortSeen(port);
        }
        view.setActiveDetailTab(tab);
        if (tab === 'preview') {
            const port = view.selectedPort;
            if (port != null) activityUnread.markPortSeen(port);
            view.setActivityDockCollapsed(true);
            void saveUi({ selectedTab: tab, activityDockCollapsed: true });
            return;
        }
        void saveUi({ selectedTab: tab });
    }

    function handleSidebarToggle(): void {
        const next = !view.sidebarCollapsed;
        view.setSidebarCollapsed(next);
        void saveUi({ sidebarCollapsed: next });
    }

    function handleActivityToggle(): void {
        if (view.activityDockCollapsed) {
            activityUnread.openAndMarkSeen();
            return;
        }
        activityUnread.closeAndPersistSeen();
    }

    function handleActivityHeight(height: number): void {
        view.setActivityDockHeight(height);
        void saveUi({ activityDockHeight: height });
    }

    function handleSidebarModeChange(mode: DashboardSidebarMode): void {
        if (view.sidebarMode === 'instances' && mode !== 'instances' && view.activeDetailTab === 'preview') {
            const port = view.selectedPort;
            if (port != null) activityUnread.markPortSeen(port);
        }
        const sidebarMode = normalizeSidebarModeForBuild(mode);
        view.setSidebarMode(sidebarMode); void saveUi({ sidebarMode });
    }

    function handleNotesSelectedPathChange(path: string | null): void {
        view.setNotesSelectedPath(path); void saveUi({ notesSelectedPath: path });
    }

    function openNotesSidebarSearch(): void {
        setNotesSidebarMode('search');
        setNotesSearchFocusToken(token => token + 1);
    }

    function handleNotesViewModeChange(mode: DashboardNotesViewMode): void {
        view.setNotesViewMode(mode); void saveUi({ notesViewMode: mode });
    }

    function handleNotesAuthoringModeChange(mode: DashboardNotesAuthoringMode): void {
        view.setNotesAuthoringMode(mode); void saveUi({ notesAuthoringMode: mode });
    }

    function handleNotesWordWrapChange(value: boolean): void {
        view.setNotesWordWrap(value); void saveUi({ notesWordWrap: value });
    }

    function handleNotesTreeWidthChange(value: number): void {
        view.setNotesTreeWidth(value); void saveUi({ notesTreeWidth: value });
    }

    const notesModel = useNotesModel({
        active: view.sidebarMode === 'notes',
        selectedPath: view.notesSelectedPath,
        onSelectedPathChange: handleNotesSelectedPathChange,
    });

    const notesSelectedNote = view.notesSelectedPath
        ? notesModel.index?.notes.find(n => n.path === view.notesSelectedPath) ?? null
        : null;

    function handleDashboardSettingsPatch(ui: NonNullable<Parameters<typeof saveUi>[0]>): void {
        if (ui.showLatestActivityTitles !== undefined) view.setShowLatestActivityTitles(ui.showLatestActivityTitles);
        if (ui.showInlineLabelEditor !== undefined) view.setShowInlineLabelEditor(ui.showInlineLabelEditor);
        if (ui.showSidebarRuntimeLine !== undefined) view.setShowSidebarRuntimeLine(ui.showSidebarRuntimeLine);
        if (ui.showSelectedRowActions !== undefined) view.setShowSelectedRowActions(ui.showSelectedRowActions);
        if (ui.dashboardShortcutsEnabled !== undefined) view.setDashboardShortcutsEnabled(ui.dashboardShortcutsEnabled);
        if (ui.dashboardShortcutKeymap !== undefined) view.setDashboardShortcutKeymap(ui.dashboardShortcutKeymap);
        if (ui.locale !== undefined) view.setLocale(ui.locale);
        void saveUi(ui);
    }

    function selectRelativeInstance(direction: 1 | -1): void {
        if (filtered.length === 0) return;
        const currentPort = selectedInstance?.port ?? null;
        const currentIndex = currentPort == null
            ? -1
            : filtered.findIndex(instance => instance.port === currentPort);
        const baseIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
        const nextIndex = (baseIndex + direction + filtered.length) % filtered.length;
        const next = filtered[nextIndex];
        if (!next) return;
        handleSelectInstance(next);
    }

    function runManagerShortcut(action: DashboardShortcutAction): void {
        if (action === 'focusInstances') {
            handleSidebarModeChange('instances');
            view.setDrawerOpen(false);
            return;
        }
        if (action === 'focusActiveSession') {
            const target = selectedInstance?.ok
                ? selectedInstance
                : filtered.find(instance => instance.ok) || null;
            if (target) handlePreview(target);
            else handleSidebarModeChange('instances');
            return;
        }
        if (action === 'focusNotes') {
            handleSidebarModeChange('notes');
            view.setDrawerOpen(false);
            return;
        }
        if (action === 'previousInstance') {
            selectRelativeInstance(-1);
            return;
        }
        if (action === 'nextInstance') {
            selectRelativeInstance(1);
        }
    }

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent): void {
            if (!view.dashboardShortcutsEnabled) return;
            if (isManagerShortcutEditableTarget(event.target)) return;
            const action = actionForShortcutEvent(event, view.dashboardShortcutKeymap);
            if (!action) return;
            event.preventDefault();
            runManagerShortcut(action);
        }
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [
        filtered,
        selectedInstance,
        view.dashboardShortcutsEnabled,
        view.dashboardShortcutKeymap,
        view.sidebarMode,
        view.activeDetailTab,
        settingsDirty,
    ]);

    async function handleLifecycle(action: DashboardLifecycleAction, instance: DashboardInstance): Promise<void> {
        const lifecycle = instance.lifecycle;
        if (!lifecycle) return;
        if (action === 'perm' && !window.confirm(`Register :${instance.port} as a persistent system service? It will auto-start on login and auto-restart on crash.`)) {
            return;
        }
        if (action === 'unperm' && !window.confirm(`Remove persistent service for :${instance.port}? The instance will stop and won't auto-start.`)) {
            return;
        }
        if (action === 'stop' && lifecycle.owner === 'service') {
            if (!window.confirm(`Stop :${instance.port}? This will also remove the persistent service.`)) return;
        } else if ((action === 'stop' || action === 'restart') && !window.confirm(`${action} :${instance.port}?`)) {
            return;
        }
        if (!canLeaveDirtySettings()) return;
        setSettingsDirty(false);
        const previousUptime = instance.uptime;
        setLifecycleBusyPort(instance.port);
        setLifecycleMessage(null);
        setTransitioningPort(instance.port);
        setTransitionAction(action);
        try {
            const home = action === 'start' ? customHome : undefined;
            const result = await runLifecycleAction(action, instance.port, home);
            const expected = result.expectedStateAfter
                || (action === 'start' || action === 'perm' ? 'online' : action === 'stop' || action === 'unperm' ? 'offline' : 'restart-detected');
            const polled = await pollUntilSettled({
                port: instance.port,
                expected,
                previousUptime,
                fetchOnce: (port, signal) => fetchInstanceStatus(port, { signal }),
            });
            if (!polled.settled) {
                setLifecycleMessage(`${result.message} (not yet reachable, refresh manually if needed)`);
            }
            await load();
            publishInvalidation({ topics: ['instances'], reason: 'instance:lifecycle', source: 'ui', sourceId: 'app' });
            view.setSelectedPort(instance.port);
        } catch (err) {
            setLifecycleMessage((err as Error).message);
        } finally {
            setLifecycleBusyPort(null);
            setTransitioningPort(null);
            setTransitionAction(null);
        }
    }

    const instanceListContent = (
        <InstanceListContent error={error} loading={loading} instances={instances} filtered={filtered}
            selectedInstance={selectedInstance} data={data} lifecycleBusyPort={lifecycleBusyPort}
            transitioningPort={transitioningPort} transitionAction={transitionAction}
            activityUnreadByPort={activityUnread.unreadByPort} latestTitleByPort={messageActivity.titlesByPort}
            busyPorts={messageActivity.busyPorts} showLatestActivityTitles={view.showLatestActivityTitles}
            showInlineLabelEditor={view.showInlineLabelEditor} showSidebarRuntimeLine={view.showSidebarRuntimeLine}
            showSelectedRowActions={view.showSelectedRowActions} profiles={profiles} getLabel={instanceLabel}
            formatUptime={formatUptime} onSelect={handleSelectInstance} onPreview={handlePreview}
            onMarkActivitySeen={activityUnread.markPortSeen} onInstanceLabelSave={labelEditor.saveInstanceLabel}
            onLifecycle={(action, instance) => void handleLifecycle(action, instance)} />
    );

    const workbenchHeader = <WorkbenchHeader instance={selectedInstance} previewEnabled={previewEnabled} onPreviewEnabledChange={setPreviewEnabled} onPreviewRefresh={() => setPreviewRefreshKey(key => key + 1)} onOpenHelpTopic={openHelpTopic} />;
    const dashboardSettingsUi = dashboardSettingsUiFromView(view, theme.theme), titleSupport = summarizeActivityTitleSupport(messageActivity.titleSupportByPort);
    const profileChipStrip = (chipProfiles: DashboardProfile[]) => chipProfiles.length > 0 ? <div className="profile-chip-strip drawer-chip-strip" aria-label="Profile filters">{chipProfiles.map(profile => <ProfileChip key={profile.profileId} profile={profile} active={activeProfileIds.includes(profile.profileId)} count={profileCounts[profile.profileId] || 0} onToggle={toggleProfile} />)}</div> : null;

    const detailContent = (tab: DashboardDetailTab) => (
        <InstanceDetailPanel
            instance={selectedInstance}
            data={data}
            activeTab={tab}
            onSettingsDirtyChange={setSettingsDirty}
            onSettingsSaved={() => { if (selectedInstance) void refreshInstance(selectedInstance.port); publishInvalidation({ topics: ['instances'], reason: 'instance:settings-saved', source: 'ui', sourceId: 'app' }); }}
            onRegistryPatch={(port, patch) => { void registry.save({ instances: { [String(port)]: patch } }).then(() => { load(); publishInvalidation({ topics: ['instances'], reason: 'instance:registry-patched', source: 'ui', sourceId: 'app' }); }); }}
        />
    );

    return <AppChrome view={view} palette={palette} theme={theme} query={query} loading={loading} showHidden={showHidden} instances={instances} selectedInstance={selectedInstance} data={data} summary={summary} scheduleGroup={scheduleGroup} boardView={boardView} notesModel={notesModel} notesSelectedNote={notesSelectedNote} notesDirtyPath={notesDirtyPath} notesSidebarMode={notesSidebarMode} notesSearchFocusToken={notesSearchFocusToken} settingsSection={dashboardSettingsSection} dashboardSettingsUi={dashboardSettingsUi} titleSupport={titleSupport} activityEvents={activityEvents} busyPorts={messageActivity.busyPorts} titlesByPort={messageActivity.titlesByPort} lifecycleMessage={lifecycleMessage} error={error} registryMessage={registry.error || labelEditor.error || managerEvents.error} workbenchHeader={workbenchHeader} detailContent={detailContent} instanceListContent={instanceListContent} drawerProfileFilters={profileChipStrip(profiles)} jawCeoWorkbenchButton={jawCeoBridge.workbenchButton} jawCeoVoiceOverlay={jawCeoBridge.voiceOverlay} jawCeoConsoleContent={jawCeoBridge.consoleContent} previewEnabled={previewEnabled} previewRefreshKey={previewRefreshKey} autoUnloadNotice={autoUnloadNotice} helpOpen={helpOpen} helpTopic={helpTopic} setQuery={setQuery} setShowHidden={setShowHidden} setPreviewEnabled={setPreviewEnabled} setAutoUnloadNotice={setAutoUnloadNotice} setHelpOpen={setHelpOpen} setHelpTopic={setHelpTopic} onOpenHelpTopic={openHelpTopic} setNotesSidebarMode={setNotesSidebarMode} setBoardView={setBoardView} setScheduleGroup={setScheduleGroup} setDashboardSettingsSection={setDashboardSettingsSection} load={load} cycleTheme={cycleTheme} openSelectedInBrowser={openSelectedInBrowser} handleSelectInstance={handleSelectInstance} handleSidebarModeChange={handleSidebarModeChange} handleSidebarToggle={handleSidebarToggle} handleNotesSelectedPathChange={handleNotesSelectedPathChange} handleNotesViewModeChange={handleNotesViewModeChange} handleNotesAuthoringModeChange={handleNotesAuthoringModeChange} handleNotesWordWrapChange={handleNotesWordWrapChange} handleNotesTreeWidthChange={handleNotesTreeWidthChange} openNotesSidebarSearch={openNotesSidebarSearch} setNotesDirtyPath={setNotesDirtyPath} handleTabChange={handleTabChange} handleActivityToggle={handleActivityToggle} handleActivityHeight={handleActivityHeight} onDismissLifecycleMessage={() => setLifecycleMessage(null)} handleDashboardSettingsPatch={handleDashboardSettingsPatch} activityUnreadOpenAndMarkSeen={activityUnread.openAndMarkSeen} />;
}

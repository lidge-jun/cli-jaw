import { useEffect, useMemo, useState } from 'react';
import { fetchInstances, runLifecycleAction } from './api';
import { ActivityDock } from './components/ActivityDock';
import { CommandBar } from './components/CommandBar';
import { InstanceDetailPanel } from './components/InstanceDetailPanel';
import { InstanceDrawer } from './components/InstanceDrawer';
import { InstanceGroups } from './components/InstanceGroups';
import { ManagerShell } from './components/ManagerShell';
import { MobileNav } from './components/MobileNav';
import { SidebarRail } from './components/SidebarRail';
import { useDashboardRegistry } from './hooks/useDashboardRegistry';
import { useDashboardView } from './hooks/useDashboardView';
import type {
    DashboardDetailTab,
    DashboardInstance,
    DashboardInstanceStatus,
    DashboardLifecycleAction,
    DashboardScanResult,
} from './types';

function formatUptime(seconds: number | null): string {
    if (seconds == null) return 'n/a';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 1) return `${Math.round(seconds)}s`;
    const hours = Math.floor(minutes / 60);
    if (hours < 1) return `${minutes}m`;
    return `${hours}h ${minutes % 60}m`;
}

function instanceLabel(instance: DashboardInstance): string {
    return instance.label || instance.instanceId || instance.homeDisplay || `port-${instance.port}`;
}

export function App() {
    const [data, setData] = useState<DashboardScanResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<'all' | DashboardInstanceStatus>('all');
    const [customHome, setCustomHome] = useState('');
    const [showHidden, setShowHidden] = useState(false);
    const [scanFromInput, setScanFromInput] = useState('');
    const [scanCountInput, setScanCountInput] = useState('');
    const [hydrated, setHydrated] = useState(false);
    const [lifecycleBusyPort, setLifecycleBusyPort] = useState<number | null>(null);
    const [lifecycleMessage, setLifecycleMessage] = useState<string | null>(null);
    const registry = useDashboardRegistry();
    const view = useDashboardView();

    async function load(nextShowHidden = showHidden): Promise<void> {
        setLoading(true);
        setError(null);
        try {
            const result = await fetchInstances(nextShowHidden);
            setData(result);
            if (result.manager.registry) {
                setScanFromInput(String(result.manager.rangeFrom));
                setScanCountInput(String(result.manager.rangeTo - result.manager.rangeFrom + 1));
            }
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    }

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
                setScanFromInput(String(loaded.registry.scan.from));
                setScanCountInput(String(loaded.registry.scan.count));
            } finally {
                setHydrated(true);
                await load();
            }
        }
        void initialize();
    }, []);

    async function saveUi(ui: Parameters<typeof registry.save>[0]['ui']): Promise<void> {
        if (!hydrated) return;
        await registry.save({ ui });
    }

    async function commitScanRange(fromValue = scanFromInput, countValue = scanCountInput): Promise<void> {
        const from = Number(fromValue);
        const count = Number(countValue);
        if (!Number.isInteger(from) || !Number.isInteger(count)) return;
        await registry.save({ scan: { from, count } });
        await load();
    }

    const instances = data?.instances || [];
    const summary = useMemo(() => {
        return instances.reduce((acc, instance) => {
            acc.total += 1;
            acc[instance.status] = (acc[instance.status] || 0) + 1;
            return acc;
        }, { total: 0 } as Record<string, number>);
    }, [instances]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return instances.filter((instance) => {
            if (status !== 'all' && instance.status !== status) return false;
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
            ].some(value => String(value || '').toLowerCase().includes(needle));
        });
    }, [instances, query, status]);

    const selectedInstance = useMemo(() => {
        if (view.selectedPort == null) return filtered.find(instance => instance.ok) || null;
        return instances.find(instance => instance.port === view.selectedPort) || null;
    }, [filtered, instances, view.selectedPort]);

    function handlePreview(instance: DashboardInstance): void {
        view.setSelectedPort(instance.port);
        view.setActiveDetailTab('preview');
        view.setPreviewEnabled(true);
        view.setDrawerOpen(false);
        void saveUi({ selectedPort: instance.port, selectedTab: 'preview' });
    }

    function handleSelectInstance(instance: DashboardInstance): void {
        view.setSelectedPort(instance.port);
        view.setActiveDetailTab('overview');
        view.setDrawerOpen(false);
        void saveUi({ selectedPort: instance.port, selectedTab: 'overview' });
    }

    function handleTabChange(tab: DashboardDetailTab): void {
        view.setActiveDetailTab(tab);
        void saveUi({ selectedTab: tab });
    }

    function handleSidebarToggle(): void {
        const next = !view.sidebarCollapsed;
        view.setSidebarCollapsed(next);
        void saveUi({ sidebarCollapsed: next });
    }

    function handleActivityToggle(): void {
        const next = !view.activityDockCollapsed;
        view.setActivityDockCollapsed(next);
        void saveUi({ activityDockCollapsed: next });
    }

    function handleActivityHeight(height: number): void {
        view.setActivityDockHeight(height);
        void saveUi({ activityDockHeight: height });
    }

    async function handleLifecycle(action: DashboardLifecycleAction, instance: DashboardInstance): Promise<void> {
        const lifecycle = instance.lifecycle;
        if (!lifecycle) return;
        if ((action === 'stop' || action === 'restart') && !window.confirm(`${action} :${instance.port}?`)) {
            return;
        }
        setLifecycleBusyPort(instance.port);
        setLifecycleMessage(null);
        try {
            const home = action === 'start' ? customHome : undefined;
            const result = await runLifecycleAction(action, instance.port, home);
            setLifecycleMessage(result.message);
            await load();
            view.setSelectedPort(instance.port);
        } catch (err) {
            setLifecycleMessage((err as Error).message);
        } finally {
            setLifecycleBusyPort(null);
        }
    }

    const instanceListContent = (
        <>
            {error && <section className="state error-state">Scan failed: {error}</section>}
            {!error && loading && <section className="state">Scanning local Jaw instances...</section>}
            {!error && (
                <InstanceGroups
                    instances={filtered}
                    selectedPort={selectedInstance?.port || null}
                    lifecycleBusyPort={lifecycleBusyPort}
                    getLabel={instanceLabel}
                    formatUptime={formatUptime}
                    onSelect={handleSelectInstance}
                    onPreview={handlePreview}
                    onLifecycle={(action, instance) => void handleLifecycle(action, instance)}
                />
            )}
        </>
    );

    return (
        <ManagerShell
            sidebarCollapsed={view.sidebarCollapsed}
            sidebar={(
                <>
                    <SidebarRail
                        onlineCount={summary.online || 0}
                        collapsed={view.sidebarCollapsed}
                        onSelectInstances={() => view.setActiveDetailTab('overview')}
                        onSelectPreview={() => view.setActiveDetailTab('preview')}
                        onSelectActivity={() => view.setActivityDockCollapsed(false)}
                        onToggleSidebar={handleSidebarToggle}
                    />
                    <div className="manager-sidebar-list">{instanceListContent}</div>
                </>
            )}
            commandBar={(
                <CommandBar
                    query={query}
                    status={status}
                    customHome={customHome}
                    loading={loading}
                    summary={summary}
                    manager={data?.manager || null}
                    showHidden={showHidden}
                    registryMessage={registry.saving ? 'Saving' : registry.error}
                    scanFrom={scanFromInput}
                    scanCount={scanCountInput}
                    onQueryChange={setQuery}
                    onStatusChange={setStatus}
                    onCustomHomeChange={setCustomHome}
                    onShowHiddenChange={(value) => {
                        setShowHidden(value);
                        void load(value);
                    }}
                    onScanFromChange={setScanFromInput}
                    onScanCountChange={setScanCountInput}
                    onScanRangeCommit={(from, count) => void commitScanRange(from, count)}
                    onRefresh={() => void load()}
                    onOpenDrawer={() => view.setDrawerOpen(true)}
                />
            )}
            detail={(
                <>
                    {lifecycleMessage && <section className="state lifecycle-state">{lifecycleMessage}</section>}
                    <InstanceDetailPanel
                        instance={selectedInstance}
                        data={data}
                        activeTab={view.activeDetailTab}
                        previewMode={view.previewMode}
                        previewEnabled={view.previewEnabled}
                        onTabChange={handleTabChange}
                        onPreviewModeChange={view.setPreviewMode}
                        onPreviewEnabledChange={view.setPreviewEnabled}
                        onRegistryPatch={(port, patch) => {
                            void registry.save({ instances: { [String(port)]: patch } }).then(() => load());
                        }}
                    />
                </>
            )}
            activity={(
                <ActivityDock
                    collapsed={view.activityDockCollapsed}
                    height={view.activityDockHeight}
                    loading={loading}
                    error={error}
                    lifecycleMessage={lifecycleMessage}
                    selectedInstance={selectedInstance}
                    previewMode={view.previewMode}
                    registryMessage={registry.error}
                    onToggle={handleActivityToggle}
                    onHeightChange={handleActivityHeight}
                />
            )}
            activityHeight={view.activityDockCollapsed ? 48 : view.activityDockHeight}
            mobileNav={(
                <MobileNav
                    activeTab={view.activeDetailTab}
                    onOpenInstances={() => view.setDrawerOpen(true)}
                    onSelectTab={view.setActiveDetailTab}
                    onToggleActivity={handleActivityToggle}
                />
            )}
            drawer={(
                <InstanceDrawer open={view.drawerOpen} onClose={() => view.setDrawerOpen(false)}>
                    {instanceListContent}
                </InstanceDrawer>
            )}
        />
    );
}

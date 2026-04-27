import { InstancePreview } from '../InstancePreview';
import type {
    DashboardDetailTab,
    DashboardInstance,
    DashboardRegistryInstance,
    DashboardPreviewMode,
    DashboardScanResult,
} from '../types';

type InstanceDetailPanelProps = {
    instance: DashboardInstance | null;
    data: DashboardScanResult | null;
    activeTab: DashboardDetailTab;
    previewMode: DashboardPreviewMode;
    previewEnabled: boolean;
    onTabChange: (tab: DashboardDetailTab) => void;
    onPreviewModeChange: (mode: DashboardPreviewMode) => void;
    onPreviewEnabledChange: (enabled: boolean) => void;
    onRegistryPatch: (port: number, patch: Partial<DashboardRegistryInstance>) => void;
};

const TABS: DashboardDetailTab[] = ['overview', 'preview', 'logs', 'settings'];

function tabLabel(tab: DashboardDetailTab): string {
    return tab[0].toUpperCase() + tab.slice(1);
}

export function InstanceDetailPanel(props: InstanceDetailPanelProps) {
    const instance = props.instance;

    return (
        <section className="detail-panel" aria-label="Selected instance detail">
            <div className="detail-header">
                <div>
                    <p className="eyebrow">Selected instance</p>
                    <h2>{instance ? `:${instance.port} ${instance.instanceId || ''}`.trim() : 'No instance selected'}</h2>
                    <span>{instance?.workingDir || instance?.url || 'Select an online instance to inspect it.'}</span>
                </div>
                {instance && <a className="open-link" href={instance.url} target="_blank" rel="noreferrer">Open</a>}
            </div>

            <div className="detail-tabs" role="tablist" aria-label="Instance detail tabs">
                {TABS.map(tab => (
                    <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={props.activeTab === tab}
                        className={props.activeTab === tab ? 'is-active' : ''}
                        onClick={() => props.onTabChange(tab)}
                    >
                        {tabLabel(tab)}
                    </button>
                ))}
            </div>

            <div className="detail-body">
                {props.activeTab === 'overview' && (
                    <div className="overview-grid">
                        <div><span>Status</span><strong>{instance?.status || 'n/a'}</strong></div>
                        <div><span>CLI</span><strong>{instance?.currentCli || 'n/a'}</strong></div>
                        <div><span>Model</span><strong>{instance?.currentModel || 'n/a'}</strong></div>
                        <div><span>Owner</span><strong>{instance?.lifecycle?.owner || 'n/a'}</strong></div>
                        <div><span>Version</span><strong>{instance?.version || 'n/a'}</strong></div>
                        <div><span>Group</span><strong>{instance?.group || 'ungrouped'}</strong></div>
                        <div><span>Reason</span><strong>{instance?.lifecycle?.reason || instance?.healthReason || 'ok'}</strong></div>
                    </div>
                )}

                {props.activeTab === 'preview' && (
                    <InstancePreview
                        instance={instance}
                        data={props.data}
                        mode={props.previewMode}
                        previewEnabled={props.previewEnabled}
                        onModeChange={props.onPreviewModeChange}
                        onPreviewEnabledChange={props.onPreviewEnabledChange}
                    />
                )}

                {props.activeTab === 'logs' && (
                    <div className="detail-empty">
                        Logs stream is planned for phase 10.7. Recent dashboard events are available in the activity dock.
                    </div>
                )}

                {props.activeTab === 'settings' && instance && (
                    <form className="settings-form" key={instance.port} onSubmit={event => event.preventDefault()}>
                        <label>
                            Label
                            <input
                                defaultValue={instance.label || ''}
                                onBlur={event => props.onRegistryPatch(instance.port, { label: event.target.value })}
                            />
                        </label>
                        <label>
                            Group
                            <input
                                defaultValue={instance.group || ''}
                                onBlur={event => props.onRegistryPatch(instance.port, { group: event.target.value })}
                            />
                        </label>
                        <label className="toggle-control">
                            <input
                                type="checkbox"
                                checked={instance.favorite === true}
                                onChange={event => props.onRegistryPatch(instance.port, { favorite: event.target.checked })}
                            />
                            Pin favorite
                        </label>
                        <label className="toggle-control">
                            <input
                                type="checkbox"
                                checked={instance.hidden === true}
                                onChange={event => props.onRegistryPatch(instance.port, { hidden: event.target.checked })}
                            />
                            Hide by default
                        </label>
                    </form>
                )}

                {props.activeTab === 'settings' && !instance && (
                    <div className="detail-empty">
                        Select an instance to edit labels, pinned state, hidden state, and groups.
                    </div>
                )}
            </div>
        </section>
    );
}

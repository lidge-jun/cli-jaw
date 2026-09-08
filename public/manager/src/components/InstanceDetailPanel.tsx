import type {
    DashboardDetailTab,
    DashboardInstance,
    DashboardRegistryInstance,
    DashboardScanResult,
} from '../types';
import { ProcessControlPanel } from './ProcessControlPanel';
import { InstanceLogsPanel } from './InstanceLogsPanel';

type InstanceDetailPanelProps = {
    instance: DashboardInstance | null;
    data: DashboardScanResult | null;
    activeTab: DashboardDetailTab;
    onRegistryPatch: (port: number, patch: Partial<DashboardRegistryInstance>) => void;
};

export function InstanceDetailPanel(props: InstanceDetailPanelProps) {
    const instance = props.instance;

    return (
        <section className="detail-panel" aria-label="Selected instance detail">
                {props.activeTab === 'overview' && (
                    <>
                        <div className="overview-grid">
                            <div><span>Status</span><strong>{instance?.status || 'n/a'}</strong></div>
                            <div><span>CLI</span><strong>{instance?.currentCli || 'n/a'}</strong></div>
                            <div><span>Model</span><strong>{instance?.currentModel || 'n/a'}</strong></div>
                            <div><span>Owner</span><strong>{instance?.lifecycle?.owner || 'n/a'}</strong></div>
                            <div><span>Version</span><strong>{instance?.version || 'n/a'}</strong></div>
                            <div><span>Group</span><strong>{instance?.group || 'ungrouped'}</strong></div>
                            <div><span>Reason</span><strong>{instance?.lifecycle?.reason || instance?.healthReason || 'ok'}</strong></div>
                        </div>
                        <ProcessControlPanel />
                    </>
                )}

                {props.activeTab === 'logs' && instance && (
                    <InstanceLogsPanel port={instance.port} />
                )}

                {props.activeTab === 'logs' && !instance && (
                    <div className="detail-empty">
                        Select an instance to view its logs.
                    </div>
                )}

        </section>
    );
}

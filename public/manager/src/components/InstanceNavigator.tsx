import type { ReactNode } from 'react';
import { InstanceRow } from './InstanceRow';
import type { DashboardInstance, DashboardLifecycleAction } from '../types';

type InstanceNavigatorProps = {
    active: DashboardInstance | null;
    hiddenCount: number;
    collapsed: boolean;
    busyPort: number | null;
    getLabel: (instance: DashboardInstance) => string;
    formatUptime: (seconds: number | null) => string;
    onSelect: (instance: DashboardInstance) => void;
    onPreview: (instance: DashboardInstance) => void;
    onLifecycle: (action: DashboardLifecycleAction, instance: DashboardInstance) => void;
    children: ReactNode;
};

export function InstanceNavigator(props: InstanceNavigatorProps) {
    if (props.collapsed) {
        return <div className="instance-navigator is-collapsed">{props.children}</div>;
    }

    return (
        <section className="instance-navigator" aria-label="Instance navigator">
            <header className="instance-navigator-header">
                <div>
                    <p className="eyebrow">Navigator</p>
                    <strong>{props.active ? `:${props.active.port}` : 'No active target'}</strong>
                </div>
                <span>{props.hiddenCount} hidden</span>
            </header>
            {props.active && (
                <section className="instance-navigator-active" aria-label="Active instance">
                    <div className="instance-group-header">
                        <span>Active</span>
                        <strong>1</strong>
                    </div>
                    <InstanceRow
                        instance={props.active}
                        selected={true}
                        busy={props.busyPort === props.active.port}
                        label={props.getLabel(props.active)}
                        uptime={props.formatUptime(props.active.uptime)}
                        priority="active"
                        density="compact"
                        onSelect={props.onSelect}
                        onPreview={props.onPreview}
                        onLifecycle={props.onLifecycle}
                    />
                </section>
            )}
            <div className="instance-navigator-scroll">{props.children}</div>
        </section>
    );
}

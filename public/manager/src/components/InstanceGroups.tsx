import { InstanceRow } from './InstanceRow';
import type {
    DashboardInstance,
    DashboardInstanceGroup,
    DashboardLifecycleAction,
} from '../types';

type InstanceGroupsProps = {
    instances: DashboardInstance[];
    selectedPort: number | null;
    lifecycleBusyPort: number | null;
    getLabel: (instance: DashboardInstance) => string;
    formatUptime: (seconds: number | null) => string;
    onSelect: (instance: DashboardInstance) => void;
    onPreview: (instance: DashboardInstance) => void;
    onLifecycle: (action: DashboardLifecycleAction, instance: DashboardInstance) => void;
};

function withoutPorts(instances: DashboardInstance[], used: Set<number>): DashboardInstance[] {
    return instances.filter(instance => !used.has(instance.port));
}

function groupInstances(instances: DashboardInstance[], selectedPort: number | null): DashboardInstanceGroup[] {
    const used = new Set<number>();
    const selected = selectedPort == null ? [] : instances.filter(instance => instance.port === selectedPort);
    selected.forEach(instance => used.add(instance.port));

    const favorites = withoutPorts(instances, used).filter(instance => instance.favorite);
    favorites.forEach(instance => used.add(instance.port));

    const userGroups = new Map<string, DashboardInstance[]>();
    for (const instance of withoutPorts(instances, used)) {
        if (!instance.group) continue;
        const group = userGroups.get(instance.group) || [];
        group.push(instance);
        userGroups.set(instance.group, group);
        used.add(instance.port);
    }

    const remaining = withoutPorts(instances, used);
    const running = remaining.filter(instance => instance.status === 'online');
    const attention = remaining.filter(instance => ['timeout', 'error', 'unknown'].includes(instance.status));
    const offline = remaining.filter(instance => instance.status === 'offline');

    const groups: DashboardInstanceGroup[] = [
        { id: 'active', label: 'Active', instances: selected },
        { id: 'favorites', label: 'Pinned', instances: favorites },
        ...Array.from(userGroups.entries()).map(([label, group]) => ({
            id: `group-${label}`,
            label,
            instances: group,
        })),
        { id: 'running', label: 'Running', instances: running },
        { id: 'attention', label: 'Attention', instances: attention },
        { id: 'offline', label: 'Offline', instances: offline },
    ];

    return groups.filter(group => group.instances.length > 0);
}

export function InstanceGroups(props: InstanceGroupsProps) {
    const groups = groupInstances(props.instances, props.selectedPort);

    if (groups.length === 0) {
        return <section className="state">No matching instances found.</section>;
    }

    return (
        <div className="instance-groups">
            {groups.map(group => (
                <section className="instance-group" key={group.id} aria-label={`${group.label} instances`}>
                    <div className="instance-group-header">
                        <span>{group.label}</span>
                        <strong>{group.instances.length}</strong>
                    </div>
                    {group.instances.map(instance => (
                        <InstanceRow
                            key={instance.port}
                            instance={instance}
                            selected={props.selectedPort === instance.port}
                            busy={props.lifecycleBusyPort === instance.port}
                            label={props.getLabel(instance)}
                            uptime={props.formatUptime(instance.uptime)}
                            onSelect={props.onSelect}
                            onPreview={props.onPreview}
                            onLifecycle={props.onLifecycle}
                        />
                    ))}
                </section>
            ))}
        </div>
    );
}

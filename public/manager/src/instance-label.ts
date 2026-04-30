import type { DashboardInstance } from './types';

function compactGeneratedInstanceName(value: string, port: number): string {
    const rawName = value.split('/').filter(Boolean).pop() || value;
    const withoutHash = rawName
        .replace(/^\.?cli-jaw-(\d+)-[a-f0-9]{7,}$/i, 'cli-jaw $1')
        .replace(/^\.?cli-jaw-(\d+)$/i, 'cli-jaw $1');
    return withoutHash || `cli-jaw ${port}`;
}

export function instanceLabel(instance: DashboardInstance): string {
    if (instance.label) return instance.label;
    const rawLabel = instance.instanceId || instance.homeDisplay || '';
    const rawName = rawLabel.split('/').filter(Boolean).pop() || rawLabel;
    return compactGeneratedInstanceName(rawName, instance.port);
}

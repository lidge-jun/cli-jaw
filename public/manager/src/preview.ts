import type { DashboardInstance, DashboardPreviewMode, DashboardScanResult } from './types';

export type PreviewState = {
    canPreview: boolean;
    src: string | null;
    reason: string | null;
    transport: PreviewTransport;
    warning: string | null;
};

export type PreviewTransport = 'origin-port' | 'legacy-path' | 'direct' | 'none';

export function buildPreviewState(
    instance: DashboardInstance | null,
    data: DashboardScanResult | null,
    mode: DashboardPreviewMode,
): PreviewState {
    if (!instance) {
        return { canPreview: false, src: null, reason: 'Select an online instance to preview.', transport: 'none', warning: null };
    }

    if (!instance.ok) {
        return { canPreview: false, src: null, reason: 'Preview is only available for online instances.', transport: 'none', warning: null };
    }

    if (mode === 'proxy') {
        const proxy = data?.manager.proxy;
        if (!proxy?.enabled) {
            return { canPreview: false, src: null, reason: 'Proxy preview is not available.', transport: 'none', warning: null };
        }
        if (instance.port < proxy.allowedFrom || instance.port > proxy.allowedTo) {
            return { canPreview: false, src: null, reason: 'This port is outside the proxy allowlist.', transport: 'none', warning: null };
        }
        const originPreview = proxy.preview?.instances[String(instance.port)];
        if (proxy.preview?.enabled && originPreview?.status === 'ready' && originPreview.url) {
            return {
                canPreview: true,
                src: originPreview.url,
                reason: null,
                transport: 'origin-port',
                warning: 'Origin proxy. Root paths are preserved through a dedicated loopback preview port.',
            };
        }
        const basePath = proxy.basePath || '/i';
        return {
            canPreview: true,
            src: `${basePath}/${instance.port}/`,
            reason: null,
            transport: 'legacy-path',
            warning: 'Using legacy path proxy. Root-relative assets, API calls, or WebSockets may fail.',
        };
    }

    return {
        canPreview: true,
        src: instance.url,
        reason: null,
        transport: 'direct',
        warning: "Direct iframe preview may be blocked by the target's frame policy.",
    };
}

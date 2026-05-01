import { useEffect, useState } from 'react';

type MetricsProcessSample = {
    type: string;
    name?: string;
    pid: number;
    rssKb: number;
    cpu: number;
};

type MetricsSnapshot = {
    ts: number;
    rendererCount: number;
    mainCount: number;
    rssTotalKb: number;
    processes: MetricsProcessSample[];
};

type ElectronMetricsResponse =
    | { available: false; reason: string }
    | { available: true; snapshot: MetricsSnapshot | null };

const POLL_INTERVAL_MS = 5000;

async function fetchElectronMetrics(): Promise<ElectronMetricsResponse> {
    const response = await fetch('/api/dashboard/electron-metrics');
    if (!response.ok) throw new Error(`electron-metrics failed: ${response.status}`);
    return await response.json() as ElectronMetricsResponse;
}

function formatMb(kb: number): string {
    return `${(kb / 1024).toFixed(1)} MB`;
}

export function ElectronMetricsPanel() {
    const [available, setAvailable] = useState<boolean | null>(null);
    const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const tick = async () => {
            try {
                const result = await fetchElectronMetrics();
                if (cancelled) return;
                if (result.available) {
                    setAvailable(true);
                    setSnapshot(result.snapshot);
                } else {
                    setAvailable(false);
                    setSnapshot(null);
                }
            } catch {
                if (!cancelled) setAvailable(false);
            }
            if (!cancelled) {
                timer = setTimeout(tick, POLL_INTERVAL_MS);
            }
        };

        void tick();

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, []);

    if (available !== true) return null;

    if (!snapshot) {
        return (
            <div className="electron-metrics-panel electron-metrics-panel--empty" role="status">
                <div className="electron-metrics-header">
                    <span className="electron-metrics-title">Desktop metrics</span>
                </div>
                <div className="electron-metrics-empty">awaiting first sample…</div>
            </div>
        );
    }

    const topThree = [...snapshot.processes]
        .sort((a, b) => b.rssKb - a.rssKb)
        .slice(0, 3);

    return (
        <div className="electron-metrics-panel" role="status" aria-label="Electron process metrics">
            <div className="electron-metrics-header">
                <span className="electron-metrics-title">Desktop metrics</span>
                <button
                    type="button"
                    className="electron-metrics-toggle"
                    onClick={() => setCollapsed(value => !value)}
                    aria-expanded={!collapsed}
                    aria-label={collapsed ? 'Expand metrics panel' : 'Collapse metrics panel'}
                >
                    {collapsed ? '▸' : '▾'}
                </button>
            </div>
            {!collapsed && (
                <div className="electron-metrics-body">
                    <div className="electron-metrics-row">
                        <span>renderers</span>
                        <span>{snapshot.rendererCount}</span>
                    </div>
                    <div className="electron-metrics-row">
                        <span>processes</span>
                        <span>{snapshot.processes.length}</span>
                    </div>
                    <div className="electron-metrics-row">
                        <span>RSS total</span>
                        <span>{formatMb(snapshot.rssTotalKb)}</span>
                    </div>
                    <div className="electron-metrics-divider" aria-hidden="true" />
                    <div className="electron-metrics-subtitle">top by RSS</div>
                    <ul className="electron-metrics-list">
                        {topThree.map((p) => (
                            <li key={p.pid}>
                                <span className="electron-metrics-proc">
                                    {p.type}
                                    {p.name ? ` · ${p.name}` : ''}
                                </span>
                                <span className="electron-metrics-proc-rss">{formatMb(p.rssKb)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

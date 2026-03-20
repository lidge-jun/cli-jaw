// ─── Worker Stall Detection Monitor ──────────────────
// Process-agnostic monitor that tracks activity timestamps
// and fires callbacks on stall, disconnect, or hard timeout.

export interface WorkerMonitorOpts {
    agentId: string;
    stallThresholdMs: number;
    maxDurationMs: number;
    onStall: (agentId: string) => void;
    onDisconnect: (agentId: string, exitCode: number | null) => void;
    onTimeout: (agentId: string) => void;
}

export function startWorkerMonitor(opts: WorkerMonitorOpts) {
    let lastActivity = Date.now();
    let stalled = false;
    let stopped = false;

    const stallTimer = setInterval(() => {
        if (stopped) return;
        const idle = Date.now() - lastActivity;
        if (idle >= opts.stallThresholdMs && !stalled) {
            stalled = true;
            opts.onStall(opts.agentId);
        }
    }, Math.min(opts.stallThresholdMs, 5_000));

    const maxTimer = setTimeout(() => {
        if (stopped) return;
        stopped = true;
        clearInterval(stallTimer);
        opts.onTimeout(opts.agentId);
    }, opts.maxDurationMs);

    return {
        touch(source: 'stdout' | 'stderr' | 'acp' | 'heartbeat') {
            lastActivity = Date.now();
            if (stalled) {
                stalled = false;
            }
        },
        exit(code: number | null) {
            if (stopped) return;
            stopped = true;
            clearInterval(stallTimer);
            clearTimeout(maxTimer);
            if (code !== 0 || code === null) {
                opts.onDisconnect(opts.agentId, code);
            }
        },
        stop() {
            if (stopped) return;
            stopped = true;
            clearInterval(stallTimer);
            clearTimeout(maxTimer);
        },
    };
}

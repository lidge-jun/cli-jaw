import { getActivePort, getBrowserRuntimeStatus, getBrowserStatus } from './connection.js';
import type { BrowserRuntimeStatus } from './runtime-owner.js';
import { inspectBrowserRuntimeOrphans, type BrowserRuntimeOrphanCandidate } from './runtime-orphans.js';

export type BrowserRuntimeIssueCode =
    | 'stale-jaw-owned-runtime'
    | 'external-runtime-not-autoclosed'
    | 'orphan-runtime-candidate';

export interface BrowserRuntimeIssue {
    code: BrowserRuntimeIssueCode;
    severity: 'info' | 'warn';
    message: string;
}

export interface BrowserRuntimeDiagnostics {
    ok: boolean;
    port: number;
    status: Awaited<ReturnType<typeof getBrowserStatus>>;
    runtime: BrowserRuntimeStatus;
    cleanup: {
        idleAutoClose: boolean;
        idleAutoCloseScope: 'current-server-jaw-owned-runtime' | 'none';
        orphanJanitor: true;
        orphanJanitorScope: 'durable-jaw-owned-runtime-records-only';
        safeExternalKill: false;
    };
    orphanCandidates: BrowserRuntimeOrphanCandidate[];
    issues: BrowserRuntimeIssue[];
    recommendations: string[];
}

export async function getBrowserDiagnostics(port = getActivePort()): Promise<BrowserRuntimeDiagnostics> {
    const status = await getBrowserStatus(port);
    const runtime = getBrowserRuntimeStatus();
    const orphanCandidates = await inspectBrowserRuntimeOrphans(runtime);
    const issues: BrowserRuntimeIssue[] = [];
    const recommendations: string[] = [];

    if (!status.running && runtime.ownership === 'jaw-owned') {
        issues.push({
            code: 'stale-jaw-owned-runtime',
            severity: 'warn',
            message: 'The server still has jaw-owned runtime metadata, but the expected CDP endpoint is not responding.',
        });
        recommendations.push('Run cli-jaw browser start again; launchChrome now clears stale jaw-owned process memory before retrying.');
    }

    if (runtime.ownership === 'external') {
        issues.push({
            code: 'external-runtime-not-autoclosed',
            severity: 'info',
            message: 'cli-jaw is attached to an external CDP browser and will not auto-close that process.',
        });
        recommendations.push('Use the owner that launched the external Chrome to close it; cli-jaw only disconnects from external runtimes.');
    }

    if (orphanCandidates.some((candidate) => candidate.action !== 'none')) {
        issues.push({
            code: 'orphan-runtime-candidate',
            severity: 'warn',
            message: 'A durable jaw-owned browser runtime record exists outside the current server runtime.',
        });
        recommendations.push('Run cli-jaw browser cleanup-runtimes for a dry-run, then add --close --force only if the candidate is expected.');
    }

    const cleanup = {
        idleAutoClose: runtime.autoCloseEnabled === true,
        idleAutoCloseScope: runtime.ownership === 'jaw-owned'
            ? 'current-server-jaw-owned-runtime' as const
            : 'none' as const,
        orphanJanitor: true as const,
        orphanJanitorScope: 'durable-jaw-owned-runtime-records-only' as const,
        safeExternalKill: false as const,
    };

    const ok = !issues.some((issue) => issue.severity === 'warn');
    return { ok, port, status, runtime, cleanup, orphanCandidates, issues, recommendations };
}

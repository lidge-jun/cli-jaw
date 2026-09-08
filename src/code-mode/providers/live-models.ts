/**
 * Live Codex model snapshot for the Code catalog.
 *
 * `CodeProvider.describe()` is synchronous and is called on every catalog read,
 * so it cannot await opencodex. This module keeps the last successful
 * `/v1/models` answer in memory and refreshes it in the background. A read
 * returns whatever is already known; it never blocks and never returns an empty
 * catalog, because an empty model list would make every model unselectable
 * (`CodeSessionManager.validate` rejects models outside `catalog.models`).
 */
import { resolveOpenCodexCodexModelsDetailed, type OpenCodexModelEntry } from '../../cli/opencodex-models.js';

export interface CodexLiveModels {
    models: string[];
    effortsByModel: Record<string, string[]>;
    defaultEffortByModel: Record<string, string>;
    /** Union of every per-model effort set, first-seen order preserved. */
    efforts: string[];
    source: 'opencodex' | 'static';
}

/** How long a successful snapshot is served before a background refresh starts. */
const REFRESH_AFTER_MS = 10_000;
/**
 * Floor between attempts after a failed or degraded probe. Without it a stale
 * snapshot plus a persistently unreachable proxy would start a fresh probe on
 * every catalog read, because only a success advances the freshness clock.
 */
const RETRY_AFTER_MS = 30_000;

let snapshot: CodexLiveModels | null = null;
let fetchedAt = 0;
let attemptedAt = 0;
let inFlight: Promise<void> | null = null;

function toSnapshot(entries: OpenCodexModelEntry[], source: CodexLiveModels['source']): CodexLiveModels {
    const effortsByModel: Record<string, string[]> = {};
    const defaultEffortByModel: Record<string, string> = {};
    const efforts: string[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
        effortsByModel[entry.id] = [...entry.efforts];
        if (entry.defaultEffort) defaultEffortByModel[entry.id] = entry.defaultEffort;
        for (const effort of entry.efforts) {
            if (seen.has(effort)) continue;
            seen.add(effort);
            efforts.push(effort);
        }
    }
    return { models: entries.map(entry => entry.id), effortsByModel, defaultEffortByModel, efforts, source };
}

function refresh(force = false): void {
    if (inFlight) return;
    if (!force && attemptedAt && Date.now() - attemptedAt < RETRY_AFTER_MS) return;
    attemptedAt = Date.now();
    inFlight = resolveOpenCodexCodexModelsDetailed()
        .then(result => {
            // A degraded probe answers with the same static list the registry already
            // holds. Keeping the previous live snapshot is better than overwriting it
            // with a fallback that hides routed models for one failed poll.
            if (result.source === 'static' && snapshot?.source === 'opencodex') return;
            if (result.entries.length === 0) return;
            snapshot = toSnapshot(result.entries, result.source);
            fetchedAt = Date.now();
        })
        .catch(() => { /* the previous snapshot stays authoritative */ })
        .finally(() => { inFlight = null; });
}

/**
 * Last known live catalog, or null before the first successful read.
 * Always schedules a refresh when the snapshot is missing or stale.
 */
export function readCodexLiveModels(): CodexLiveModels | null {
    if (!snapshot || Date.now() - fetchedAt > REFRESH_AFTER_MS) refresh();
    return snapshot;
}

/** Warm the snapshot so the first catalog read after startup is already live. */
export async function primeCodexLiveModels(): Promise<CodexLiveModels | null> {
    refresh(true);
    await inFlight;
    return snapshot;
}

/** @internal exported for unit tests */
export function resetCodexLiveModelsForTest(next?: CodexLiveModels): void {
    snapshot = next ?? null;
    fetchedAt = next ? Date.now() : 0;
    attemptedAt = 0;
    inFlight = null;
}

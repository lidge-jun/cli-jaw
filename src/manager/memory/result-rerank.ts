import type { SearchHit } from '../../memory/shared.js';
import type { FederatedHit, InstanceMemoryRef } from './types.js';

export interface RerankOptions { perInstanceLimit: number; globalLimit: number; }

const RRF_K = 60;

export function rerankAcrossInstances(
    perInstance: Array<{ ref: InstanceMemoryRef; hits: SearchHit[] }>,
    opts: RerankOptions,
): FederatedHit[] {
    const merged: FederatedHit[] = [];
    for (const { ref, hits } of perInstance) {
        const capped = hits.slice(0, opts.perInstanceLimit);
        capped.forEach((hit, rank) => {
            merged.push({
                ...hit,
                instanceId: ref.instanceId,
                instanceLabel: ref.label,
                instancePort: ref.port,
                rrfScore: 1 / (RRF_K + rank),
            });
        });
    }
    return merged
        .sort((a, b) => {
            if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
            if (a.instanceId !== b.instanceId) return a.instanceId < b.instanceId ? -1 : 1;
            if (a.relpath !== b.relpath) return a.relpath < b.relpath ? -1 : 1;
            return a.source_start_line - b.source_start_line;
        })
        .slice(0, opts.globalLimit);
}

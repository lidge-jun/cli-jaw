import { searchIndexReadOnly } from '../../memory/indexing.js';
import { listSearchableInstances } from './instance-discovery.js';
import { rerankAcrossInstances } from './result-rerank.js';
import type { SearchHit } from '../../memory/shared.js';
import type {
    FederatedSearchResult,
    FederationWarning,
    InstanceMemoryRef,
} from './types.js';

export interface FederatedSearchOptions {
    instanceFilter?: string[];
    perInstanceLimit?: number;
    globalLimit?: number;
    instances?: InstanceMemoryRef[];
}

export function searchFederated(query: string, opts: FederatedSearchOptions = {}): FederatedSearchResult {
    const trimmed = String(query || '').trim();
    if (!trimmed) return { hits: [], warnings: [], instancesQueried: 0, instancesSucceeded: 0 };

    const all = opts.instances ?? listSearchableInstances();
    const filter = opts.instanceFilter;
    const filtered = filter?.length ? all.filter(r => filter.includes(r.instanceId)) : all;

    const warnings: FederationWarning[] = [];
    const perInstanceHits: Array<{ ref: InstanceMemoryRef; hits: SearchHit[] }> = [];
    let succeeded = 0;

    for (const ref of filtered) {
        if (!ref.hasDb) {
            warnings.push({
                instanceId: ref.instanceId,
                code: 'missing_db',
                message: `No index.sqlite at ${ref.dbPath}`,
            });
            continue;
        }
        try {
            const { hits, degraded } = searchIndexReadOnly(ref.dbPath, trimmed);
            if (degraded.length) {
                warnings.push({
                    instanceId: ref.instanceId,
                    code: 'schema_mismatch',
                    message: `Older schema: degraded ${degraded.join(', ')}`,
                    detail: { degraded },
                });
            }
            perInstanceHits.push({ ref, hits });
            succeeded++;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const code: FederationWarning['code'] =
                /NODE_MODULE_VERSION/.test(msg) ? 'native_module_mismatch'
                : /malformed|corrupt/i.test(msg) ? 'corrupt'
                : /unable to open/i.test(msg) ? 'open_failed'
                : 'query_failed';
            warnings.push({ instanceId: ref.instanceId, code, message: msg });
        }
    }

    const reranked = rerankAcrossInstances(perInstanceHits, {
        perInstanceLimit: opts.perInstanceLimit ?? 10,
        globalLimit: opts.globalLimit ?? 50,
    });

    return {
        hits: reranked,
        warnings,
        instancesQueried: filtered.length,
        instancesSucceeded: succeeded,
    };
}

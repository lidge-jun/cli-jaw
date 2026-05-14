import type { SearchHit } from '../../../memory/shared.js';
import type { VecSearchHit } from './vec-store.js';

export interface HybridHit extends SearchHit {
  instanceId: string;
  embeddingDistance?: number;
  ftsRank?: number;
  vecRank?: number;
  hybridScore: number;
}

interface HybridOptions {
  ftsHits: Array<SearchHit & { instanceId: string }>;
  vecHits: VecSearchHit[];
  limit: number;
  k?: number;
}

export function hybridMerge(opts: HybridOptions): HybridHit[] {
  const k = opts.k ?? 60;
  const scoreMap = new Map<string, HybridHit>();

  function hitKey(instanceId: string, relpath: string, startLine: number): string {
    return `${instanceId}:${relpath}:${startLine}`;
  }

  for (let i = 0; i < opts.ftsHits.length; i++) {
    const h = opts.ftsHits[i]!;
    const key = hitKey(h.instanceId, h.relpath, h.source_start_line);
    const rrf = 1 / (k + i + 1);
    const existing = scoreMap.get(key);
    if (existing) {
      existing.ftsRank = i;
      existing.hybridScore += rrf;
    } else {
      scoreMap.set(key, {
        path: h.path,
        relpath: h.relpath,
        kind: h.kind,
        source_start_line: h.source_start_line,
        source_end_line: h.source_end_line,
        snippet: h.snippet,
        score: h.score,
        instanceId: h.instanceId,
        ftsRank: i,
        hybridScore: rrf,
      });
    }
  }

  for (let i = 0; i < opts.vecHits.length; i++) {
    const v = opts.vecHits[i]!;
    const key = hitKey(v.instanceId, v.relpath, v.sourceStartLine);
    const rrf = 1 / (k + i + 1);
    const existing = scoreMap.get(key);
    if (existing) {
      existing.vecRank = i;
      existing.embeddingDistance = v.distance;
      existing.hybridScore += rrf;
    } else {
      scoreMap.set(key, {
        path: '',
        relpath: v.relpath,
        kind: v.kind,
        source_start_line: v.sourceStartLine,
        source_end_line: v.sourceEndLine,
        snippet: v.snippet,
        score: 0,
        instanceId: v.instanceId,
        embeddingDistance: v.distance,
        vecRank: i,
        hybridScore: rrf,
      });
    }
  }

  return [...scoreMap.values()]
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, opts.limit);
}

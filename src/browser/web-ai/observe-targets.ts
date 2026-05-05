export interface SemanticTarget {
    roles?: readonly string[];
    names?: readonly RegExp[];
    excludeNames?: readonly RegExp[];
    required?: boolean;
    cssFallbacks?: readonly string[];
}

export interface FeatureMap {
    semanticTargets?: Record<string, SemanticTarget>;
}

export interface SnapshotLike {
    refs?: Record<string, RefLike>;
}

export interface RefLike {
    ref: string;
    role: string;
    name?: string;
}

export interface ObserveTargetsPageLike {
    locator: (selector: string) => {
        count: () => Promise<number>;
        nth: (index: number) => {
            isVisible: () => Promise<boolean>;
        };
    };
}

export interface TargetCandidate {
    source: string;
    ref?: string;
    role?: string;
    name?: string;
    selector?: string;
    count?: number;
    confidence: number;
    [key: string]: unknown;
}

export interface ObserveOptions {
    provider?: string | null;
    featureMap?: FeatureMap;
    snapshot?: SnapshotLike | null;
}

export interface RankOptions {
    expectedRole?: string | null;
    expectedNames?: readonly RegExp[];
}

export async function observeProviderTargets(
    page: ObserveTargetsPageLike,
    {
        provider = null,
        featureMap = {},
        snapshot = null,
    }: ObserveOptions = {},
): Promise<Record<string, TargetCandidate[]>> {
    void provider;
    const semanticTargets = semanticTargetsFromFeatureMap(featureMap);
    const results: Record<string, TargetCandidate[]> = {};
    for (const [feature, target] of Object.entries(semanticTargets)) {
        const candidates: TargetCandidate[] = [];
        if (snapshot?.refs) {
            for (const ref of Object.values(snapshot.refs)) {
                if (!targetMatchesRef(target, ref)) continue;
                candidates.push({
                    source: 'snapshot-ref',
                    ref: ref.ref,
                    role: ref.role,
                    name: ref.name || '',
                    confidence: scoreCandidate({ role: ref.role, name: ref.name || '' }, target),
                });
            }
        }
        for (const selector of target.cssFallbacks || []) {
            const count = await page.locator(selector).count().catch(() => 0);
            if (count > 0) {
                candidates.push({ source: 'css', selector, count, confidence: count === 1 ? 2 : 1 });
            }
        }
        results[feature] = rankTargetCandidates(candidates, {
            expectedRole: target.roles?.[0] || null,
            expectedNames: target.names || [],
        });
    }
    return results;
}

function semanticTargetsFromFeatureMap(featureMap: FeatureMap = {}): Record<string, SemanticTarget> {
    if ('semanticTargets' in featureMap && featureMap.semanticTargets) return featureMap.semanticTargets;
    return featureMap as Record<string, SemanticTarget>;
}

export function rankTargetCandidates(
    candidates: TargetCandidate[],
    { expectedRole = null, expectedNames = [] }: RankOptions = {},
): TargetCandidate[] {
    return [...(candidates || [])].sort((a, b) => {
        const aScore = Number(a.confidence || 0)
            + (expectedRole && a.role === expectedRole ? 2 : 0)
            + (expectedNames.some(pattern => pattern.test?.(a.name || '')) ? 1 : 0)
            + (a.source === 'snapshot-ref' ? 0.5 : 0);
        const bScore = Number(b.confidence || 0)
            + (expectedRole && b.role === expectedRole ? 2 : 0)
            + (expectedNames.some(pattern => pattern.test?.(b.name || '')) ? 1 : 0)
            + (b.source === 'snapshot-ref' ? 0.5 : 0);
        return bScore - aScore;
    });
}

function targetMatchesRef(target: SemanticTarget, ref: RefLike): boolean {
    if (target.roles?.length && !target.roles.includes(ref.role)) return false;
    const name = ref.name || '';
    if (target.excludeNames?.some(pattern => pattern.test(name))) return false;
    if (target.names?.length && !target.names.some(pattern => pattern.test(name))) return false;
    return true;
}

function scoreCandidate(candidate: { role: string; name: string }, target: SemanticTarget): number {
    let score = 0;
    if (target.roles?.includes(candidate.role)) score += 2;
    if (target.names?.some(pattern => pattern.test(candidate.name || ''))) score += 2;
    if (target.required) score += 1;
    return score;
}

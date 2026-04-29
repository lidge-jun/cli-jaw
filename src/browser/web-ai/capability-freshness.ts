export interface FreshnessGateRecord {
    retrievalDate: string;
    vendorDocsSearched: string[];
    officialSourcesUsed: string[];
    visibleUpdatedDates: Record<string, string>;
    featureChangesSincePriorPrd: string[];
    contradictionsOrUnstableLimits: string[];
    uiAuthoritativeForPlanLimits: boolean;
    implementationImpact: string[];
    testsUpdatedBecauseOfDocs: string[];
}

export function validateFreshnessGate(record: Partial<FreshnessGateRecord>): FreshnessGateRecord {
    const required: (keyof FreshnessGateRecord)[] = [
        'retrievalDate',
        'vendorDocsSearched',
        'officialSourcesUsed',
        'visibleUpdatedDates',
        'featureChangesSincePriorPrd',
        'contradictionsOrUnstableLimits',
        'uiAuthoritativeForPlanLimits',
        'implementationImpact',
        'testsUpdatedBecauseOfDocs',
    ];
    for (const key of required) {
        if (record[key] === undefined || record[key] === null) {
            throw new Error(`freshness gate missing field: ${String(key)}`);
        }
    }
    if (!Array.isArray(record.officialSourcesUsed) || record.officialSourcesUsed.length === 0) {
        throw new Error('freshness gate requires at least one official source');
    }
    if (!record.uiAuthoritativeForPlanLimits) {
        throw new Error('freshness gate requires uiAuthoritativeForPlanLimits=true');
    }
    return record as FreshnessGateRecord;
}


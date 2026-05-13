import type { SearchHit } from '../../memory/shared.js';

export interface InstanceMemoryRef {
    instanceId: string;
    homePath: string;
    homeSource: 'profile' | 'default-port';
    port: number;
    label: string | null;
    dbPath: string;
    hasDb: boolean;
}

export interface FederatedHit extends SearchHit {
    instanceId: string;
    instanceLabel: string | null;
    instancePort: number;
    rrfScore: number;
}

export interface FederationWarning {
    instanceId: string;
    code:
        | 'missing_db'
        | 'open_failed'
        | 'query_failed'
        | 'corrupt'
        | 'native_module_mismatch'
        | 'schema_mismatch';
    message: string;
    detail?: { missing?: string[]; degraded?: string[] };
}

export interface FederatedSearchResult {
    hits: FederatedHit[];
    warnings: FederationWarning[];
    instancesQueried: number;
    instancesSucceeded: number;
}

export interface ScanItemForFederation {
    port: number;
    profileId?: string | null;
    homeDisplay?: string | null;
}

import { useCallback, useState } from 'react';
import { fetchRegistry, patchDashboardRegistry } from '../api';
import type {
    DashboardRegistry,
    DashboardRegistryLoadResult,
    DashboardRegistryPatch,
    DashboardRegistryStatus,
} from '../types';

type DashboardRegistryState = {
    registry: DashboardRegistry | null;
    status: DashboardRegistryStatus | null;
    saving: boolean;
    error: string | null;
    apply: (result: DashboardRegistryLoadResult) => DashboardRegistryLoadResult;
    refresh: () => Promise<DashboardRegistryLoadResult>;
    save: (patch: DashboardRegistryPatch) => Promise<DashboardRegistryLoadResult | null>;
};

export function useDashboardRegistry(): DashboardRegistryState {
    const [registry, setRegistry] = useState<DashboardRegistry | null>(null);
    const [status, setStatus] = useState<DashboardRegistryStatus | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const applyResult = useCallback((result: DashboardRegistryLoadResult): DashboardRegistryLoadResult => {
        setRegistry(result.registry);
        setStatus(result.status);
        setError(result.status.error);
        return result;
    }, []);

    const refresh = useCallback(async (): Promise<DashboardRegistryLoadResult> => {
        try {
            return applyResult(await fetchRegistry());
        } catch (err) {
            setError((err as Error).message);
            throw err;
        }
    }, [applyResult]);

    const save = useCallback(async (patch: DashboardRegistryPatch): Promise<DashboardRegistryLoadResult | null> => {
        setSaving(true);
        try {
            return applyResult(await patchDashboardRegistry(patch));
        } catch (err) {
            setError((err as Error).message);
            return null;
        } finally {
            setSaving(false);
        }
    }, [applyResult]);

    return { registry, status, saving, error, apply: applyResult, refresh, save };
}

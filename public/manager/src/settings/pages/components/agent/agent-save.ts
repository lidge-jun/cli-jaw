import type { SettingsClient } from '../../../types';
import { expandPatch } from '../../path-utils';
import {
    applyRuntimeEmployeesDiff,
    runtimeEmployeesHaveErrors,
    unwrapRuntimeEmployees,
    type RuntimeEmployeeRecord,
    type RuntimeEmployeesResponse,
} from './runtime-employees-helpers';

export type AgentSettingsSnapshot = {
    [key: string]: unknown;
};

const SYNTHETIC_KEYS = new Set(['runtimeEmployees', 'flushCli', 'flushModel']);

export function splitAgentSaveBundle(bundle: Record<string, unknown>): {
    settingsBundle: Record<string, unknown>;
    flushPatch: { cli?: string; model?: string } | null;
    runtimeEmployeesNext: RuntimeEmployeeRecord[] | null;
} {
    const settingsBundle: Record<string, unknown> = {};
    let flushPatch: { cli?: string; model?: string } | null = null;
    let runtimeEmployeesNext: RuntimeEmployeeRecord[] | null = null;
    for (const [key, value] of Object.entries(bundle)) {
        if (key === 'runtimeEmployees') {
            runtimeEmployeesNext = value as RuntimeEmployeeRecord[];
        } else if (key === 'flushCli' || key === 'flushModel') {
            flushPatch ??= {};
            flushPatch[key === 'flushCli' ? 'cli' : 'model'] = String(value ?? '');
        } else if (!SYNTHETIC_KEYS.has(key)) {
            settingsBundle[key] = value;
        }
    }
    return { settingsBundle, flushPatch, runtimeEmployeesNext };
}

export async function saveAgentRuntime(options: {
    client: SettingsClient;
    bundle: Record<string, unknown>;
    employeeDraft: RuntimeEmployeeRecord[];
    employeeOriginal: RuntimeEmployeeRecord[];
}): Promise<AgentSettingsSnapshot | null> {
    const { client, bundle, employeeDraft, employeeOriginal } = options;
    if (runtimeEmployeesHaveErrors(employeeDraft)) {
        throw new Error('runtime employees: fix invalid rows before saving');
    }
    const { settingsBundle, flushPatch, runtimeEmployeesNext } = splitAgentSaveBundle(bundle);
    let freshSettings: AgentSettingsSnapshot | null = null;
    try {
        if (Object.keys(settingsBundle).length > 0) {
            const updated = await client.put<AgentSettingsSnapshot>('/api/settings', expandPatch(settingsBundle));
            freshSettings = (updated && typeof updated === 'object' && 'data' in updated
                ? (updated as { data: AgentSettingsSnapshot }).data
                : updated) as AgentSettingsSnapshot;
        }
    } catch (err: unknown) {
        throw new Error(`settings save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
        if (flushPatch) await client.put('/api/memory-files/settings', flushPatch);
    } catch (err: unknown) {
        throw new Error(`flush settings save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
        if (runtimeEmployeesNext) {
            // The Classic sidebar writes employees immediately and independently, so by save
            // time the server can hold rows this page never saw. Two things follow, and only
            // doing the first is worse than doing neither.
            //
            // Re-read so the diff is computed against reality rather than a stale snapshot.
            // Then restrict deletion to rows this page actually knew about: a row that appeared
            // on the server while the page was open is absent from the draft, which the plain
            // diff reads as "the user removed it" and deletes. It was never the user's to
            // remove. Additions and updates still come from the draft as the user expressed
            // them.
            //
            // A failed re-read falls back to the snapshot rather than blocking the save: the
            // stale diff is still the caller's explicit intent, and refusing to save would
            // discard it.
            let baseline = employeeOriginal;
            try {
                const server = unwrapRuntimeEmployees(await client.get<RuntimeEmployeesResponse>('/api/employees'));
                const knownToThisPage = new Set(employeeOriginal.map(row => row.id));
                const draftIds = new Set(runtimeEmployeesNext.map(row => row.id));
                baseline = server.filter(row => knownToThisPage.has(row.id) || draftIds.has(row.id));
            } catch { /* keep the snapshot baseline */ }
            await applyRuntimeEmployeesDiff(client, baseline, runtimeEmployeesNext);
        }
    } catch (err: unknown) {
        throw new Error(`runtime employees save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return freshSettings;
}

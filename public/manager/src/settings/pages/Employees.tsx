// Phase 6 — Employees roster CRUD page.
//
// CRUD over `settings.employees` (array of `{ id, name, cli, role,
// prompt?, active }`). Save writes the whole array via `/api/settings`
// PUT, coalesced into the shared SaveBar via the page's registered
// save handler. The dirty store gets a single synthetic `employees`
// key so the shell knows the page is dirty.
//
// Backwards-compat: legacy installs may store a bare `string[]` of
// names — `normalizeEmployees` handles both shapes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SettingsPageProps } from '../types';
import {
    SettingsSection,
    PageError,
    PageLoading,
    PageOffline,
    usePageSnapshot,
} from './page-shell';
import { EmployeeRow } from './components/EmployeeRow';
import {
    EMPLOYEE_KEYS,
    duplicateNameSet,
    employeeRowError,
    employeesHaveErrors,
    makeDefaultEmployee,
    normalizeEmployees,
    toPersistShape,
    type EmployeeRecord,
} from './components/employees-helpers';

export {
    EMPLOYEE_KEYS,
    duplicateNameSet,
    employeeRowError,
    employeesHaveErrors,
    makeDefaultEmployee,
    newEmployeeId,
    normalizeEmployees,
    toPersistShape,
    DEFAULT_CLI_OPTIONS,
} from './components/employees-helpers';
export type { EmployeeRecord } from './components/employees-helpers';

type SettingsSnapshot = {
    employees?: unknown;
    perCli?: Record<string, unknown>;
    [key: string]: unknown;
};

function rosterEqual(a: ReadonlyArray<EmployeeRecord>, b: ReadonlyArray<EmployeeRecord>): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        const x = a[i]!;
        const y = b[i]!;
        if (
            x.id !== y.id ||
            x.name !== y.name ||
            x.cli !== y.cli ||
            x.role !== y.role ||
            x.prompt !== y.prompt ||
            x.active !== y.active
        ) {
            return false;
        }
    }
    return true;
}

export default function Employees({ port, client, dirty, registerSave }: SettingsPageProps) {
    const { state, refresh, setData } = usePageSnapshot<SettingsSnapshot>(
        client,
        '/api/settings',
    );

    const [roster, setRoster] = useState<EmployeeRecord[]>([]);
    const [original, setOriginal] = useState<EmployeeRecord[]>([]);

    useEffect(() => {
        if (state.kind !== 'ready') return;
        const parsed = normalizeEmployees(state.data.employees);
        setRoster(parsed);
        setOriginal(parsed);
    }, [state]);

    // Sync local draft into the shared dirty store so the shell knows
    // the page is dirty and can gate Save.
    useEffect(() => {
        const valid = !employeesHaveErrors(roster) && duplicateNameSet(roster).size === 0;
        if (rosterEqual(roster, original)) {
            dirty.remove('employees');
            return;
        }
        dirty.set('employees', { value: roster, original, valid });
    }, [roster, original, dirty]);

    useEffect(() => {
        return () => {
            for (const key of EMPLOYEE_KEYS) dirty.remove(key);
        };
    }, [dirty]);

    // Race guard so a stale save can't overwrite fresh local state.
    const saveTokenRef = useRef(0);

    const onSave = useCallback(async () => {
        if (employeesHaveErrors(roster) || duplicateNameSet(roster).size > 0) {
            throw new Error('Fix invalid employees before saving.');
        }
        const token = ++saveTokenRef.current;
        const patch = { employees: toPersistShape(roster) };
        const updated = await client.put<SettingsSnapshot>('/api/settings', patch);
        if (token !== saveTokenRef.current) return;
        const fresh = (updated && typeof updated === 'object' && 'data' in updated
            ? (updated as { data: SettingsSnapshot }).data
            : updated) as SettingsSnapshot;
        const parsed = normalizeEmployees(fresh.employees);
        setRoster(parsed);
        setOriginal(parsed);
        dirty.remove('employees');
        setData(fresh);
        await refresh();
    }, [client, dirty, refresh, roster, setData]);

    useEffect(() => {
        if (!registerSave) return;
        registerSave(onSave);
        return () => registerSave(null);
    }, [registerSave, onSave]);

    const cliOptions = useMemo<string[]>(() => {
        if (state.kind !== 'ready') return [];
        return Object.keys(state.data.perCli || {});
    }, [state]);

    if (state.kind === 'loading') return <PageLoading />;
    if (state.kind === 'offline') return <PageOffline port={port} />;
    if (state.kind === 'error') return <PageError message={state.message} />;

    const dupes = duplicateNameSet(roster);

    function updateRow(idx: number, patch: Partial<EmployeeRecord>) {
        setRoster((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
    }
    function addRow() {
        setRoster((prev) => [...prev, makeDefaultEmployee()]);
    }
    function removeRow(idx: number) {
        setRoster((prev) => prev.filter((_, i) => i !== idx));
    }

    return (
        <form
            className="settings-page-form"
            onSubmit={(event) => {
                event.preventDefault();
                void onSave();
            }}
        >
            <SettingsSection
                title="Employees"
                hint="Roster of agents this instance can dispatch. Saved as `settings.employees` — the whole array is replaced on save."
            >
                {roster.length === 0 ? (
                    <p className="settings-section-hint">
                        No employees configured. Add one below.
                    </p>
                ) : (
                    <div className="settings-employee-list">
                        {roster.map((employee, idx) => {
                            const nameError = employeeRowError(employee);
                            const isDupe = dupes.has(employee.name.trim().toLowerCase());
                            return (
                                <EmployeeRow
                                    key={employee.id}
                                    employee={employee}
                                    index={idx}
                                    cliOptions={cliOptions}
                                    nameError={nameError}
                                    duplicateName={isDupe}
                                    onChange={(patch) => updateRow(idx, patch)}
                                    onRemove={() => removeRow(idx)}
                                />
                            );
                        })}
                    </div>
                )}
                <div className="settings-employee-footer-bar">
                    <button
                        type="button"
                        className="settings-action settings-action-discard"
                        onClick={addRow}
                    >
                        + Add employee
                    </button>
                </div>
            </SettingsSection>
        </form>
    );
}

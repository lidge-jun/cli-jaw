// Phase 6 — single editable row in the Employees roster.
//
// Pure presentational. Owns no state — propagates changes through
// `onChange` so the parent list keeps the canonical roster array.

import { useId } from 'react';
import { TextField, ToggleField, SelectField } from '../../fields';
import type { EmployeeRecord } from './employees-helpers';
import { DEFAULT_CLI_OPTIONS } from './employees-helpers';

type Props = {
    employee: EmployeeRecord;
    index: number;
    cliOptions: ReadonlyArray<string>;
    nameError?: string | null;
    duplicateName?: boolean;
    onChange: (patch: Partial<EmployeeRecord>) => void;
    onRemove: () => void;
};

export function EmployeeRow({
    employee,
    index,
    cliOptions,
    nameError,
    duplicateName,
    onChange,
    onRemove,
}: Props) {
    const idBase = useId();

    // Build the CLI dropdown defensively: include the current value
    // even if the perCli map doesn't list it (legacy roster entry).
    const baseSet = new Set<string>([
        ...cliOptions,
        ...DEFAULT_CLI_OPTIONS,
    ]);
    if (employee.cli) baseSet.add(employee.cli);
    const opts = Array.from(baseSet).map((value) => ({
        value,
        label: cliOptions.includes(value) ? value : `${value} (legacy)`,
    }));

    const dupeError = duplicateName ? 'Another employee already uses this name' : null;
    const renderedNameError = nameError ?? dupeError;

    return (
        <fieldset
            className="settings-employee-row"
            aria-label={`Employee ${index + 1}${employee.name ? ` (${employee.name})` : ''}`}
        >
            <legend className="settings-employee-legend">
                {employee.name || `Employee ${index + 1}`}
            </legend>

            <ToggleField
                id={`${idBase}-active`}
                label="Active"
                value={employee.active}
                onChange={(next) => onChange({ active: next })}
            />

            <TextField
                id={`${idBase}-name`}
                label="Name"
                value={employee.name}
                placeholder="Frontend"
                error={renderedNameError}
                onChange={(next) => onChange({ name: next })}
            />

            <TextField
                id={`${idBase}-role`}
                label="Role / specialty"
                value={employee.role}
                placeholder="UI/UX, CSS, components"
                onChange={(next) => onChange({ role: next })}
            />

            <SelectField
                id={`${idBase}-cli`}
                label="Default CLI"
                value={employee.cli}
                options={opts}
                onChange={(next) => onChange({ cli: next })}
            />

            <label
                className="settings-field settings-field-textarea"
                htmlFor={`${idBase}-prompt`}
            >
                <span className="settings-field-label">System prompt (optional)</span>
                <textarea
                    id={`${idBase}-prompt`}
                    rows={3}
                    value={employee.prompt}
                    placeholder="Override the default system prompt for this employee."
                    onChange={(event) => onChange({ prompt: event.target.value })}
                />
            </label>

            <div className="settings-employee-footer">
                <button
                    type="button"
                    className="settings-action settings-action-discard"
                    onClick={onRemove}
                    aria-label={`Remove employee ${employee.name || index + 1}`}
                >
                    Remove
                </button>
            </div>
        </fieldset>
    );
}

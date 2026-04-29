import { SelectField } from '../../../fields';
import { SettingsSection } from '../../page-shell';
import {
    isAllowlistValid,
    parsePermissionsValue,
    seedAutoAllowlist,
} from '../../Permissions';

type PermissionQuickSectionProps = {
    value: unknown;
    onChange(next: 'auto' | string[]): void;
};

const MODE_OPTIONS = [
    { value: 'auto', label: 'Auto' },
    { value: 'custom', label: 'Custom allowlist' },
];

export function PermissionQuickSection({ value, onChange }: PermissionQuickSectionProps) {
    const parsed = parsePermissionsValue(value);
    const mode = parsed.mode === 'custom' ? 'custom' : 'auto';
    const tokens = parsed.mode === 'custom' ? parsed.tokens : [];
    const summary = parsed.mode === 'custom'
        ? `${tokens.length} explicit token${tokens.length === 1 ? '' : 's'}`
        : 'Runtime resolves allowed capabilities';

    return (
        <SettingsSection
            title="Permissions"
            hint="Quick runtime mode. Open Permissions for detailed allowlist editing."
        >
            <SelectField
                id="agent-permissions-mode"
                label="Mode"
                value={mode}
                options={MODE_OPTIONS}
                onChange={(next) => {
                    if (next === 'auto') onChange('auto');
                    else onChange(tokens.length > 0 && isAllowlistValid(tokens) ? tokens : seedAutoAllowlist(null));
                }}
            />
            <p className="settings-agent-note">{summary}</p>
        </SettingsSection>
    );
}

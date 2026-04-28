type Option = { value: string; label: string };

type Props = {
    id: string;
    label: string;
    value: string;
    options: ReadonlyArray<Option>;
    onChange: (next: string) => void;
    disabled?: boolean;
    error?: string | null;
};

export function SelectField({ id, label, value, options, onChange, disabled, error }: Props) {
    return (
        <label className="settings-field settings-field-select" htmlFor={id}>
            <span className="settings-field-label">{label}</span>
            <select
                id={id}
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
                aria-invalid={Boolean(error)}
            >
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
            {error ? <span className="settings-field-error">{error}</span> : null}
        </label>
    );
}

type Props = {
    id: string;
    label: string;
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    disabled?: boolean;
    error?: string | null;
};

export function TextField({ id, label, value, onChange, placeholder, disabled, error }: Props) {
    return (
        <label className="settings-field settings-field-text" htmlFor={id}>
            <span className="settings-field-label">{label}</span>
            <input
                id={id}
                type="text"
                value={value}
                placeholder={placeholder}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
                aria-invalid={Boolean(error)}
            />
            {error ? <span className="settings-field-error">{error}</span> : null}
        </label>
    );
}

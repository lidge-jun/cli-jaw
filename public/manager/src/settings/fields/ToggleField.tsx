type Props = {
    id: string;
    label: string;
    value: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
    description?: string;
};

export function ToggleField({ id, label, value, onChange, disabled, description }: Props) {
    return (
        <label className="settings-field settings-field-toggle" htmlFor={id}>
            <span className="settings-field-label">{label}</span>
            <input
                id={id}
                type="checkbox"
                checked={value}
                disabled={disabled}
                onChange={(event) => onChange(event.target.checked)}
            />
            {description ? <span className="settings-field-description">{description}</span> : null}
        </label>
    );
}

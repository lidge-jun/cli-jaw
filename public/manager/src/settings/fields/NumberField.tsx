type Props = {
    id: string;
    label: string;
    value: number;
    onChange: (next: number) => void;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    error?: string | null;
};

export function NumberField({
    id,
    label,
    value,
    onChange,
    min,
    max,
    step,
    disabled,
    error,
}: Props) {
    return (
        <label className="settings-field settings-field-number" htmlFor={id}>
            <span className="settings-field-label">{label}</span>
            <input
                id={id}
                type="number"
                value={Number.isFinite(value) ? value : 0}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                aria-invalid={Boolean(error)}
                onChange={(event) => {
                    const parsed = Number(event.target.value);
                    onChange(Number.isFinite(parsed) ? parsed : 0);
                }}
            />
            {error ? <span className="settings-field-error">{error}</span> : null}
        </label>
    );
}

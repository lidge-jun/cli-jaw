import { useState } from 'react';

type Props = {
    id: string;
    label: string;
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    disabled?: boolean;
    error?: string | null;
    masked?: boolean;
};

export function SecretField({
    id,
    label,
    value,
    onChange,
    placeholder,
    disabled,
    error,
    masked = true,
}: Props) {
    const [revealed, setRevealed] = useState(!masked);
    return (
        <label className="settings-field settings-field-secret" htmlFor={id}>
            <span className="settings-field-label">{label}</span>
            <span className="settings-field-row">
                <input
                    id={id}
                    type={revealed ? 'text' : 'password'}
                    value={value}
                    placeholder={placeholder}
                    disabled={disabled}
                    onChange={(event) => onChange(event.target.value)}
                    aria-invalid={Boolean(error)}
                    autoComplete="off"
                    spellCheck={false}
                />
                <button
                    type="button"
                    className="settings-field-reveal"
                    onClick={() => setRevealed((r) => !r)}
                    disabled={disabled}
                    aria-pressed={revealed}
                >
                    {revealed ? 'Hide' : 'Show'}
                </button>
            </span>
            {error ? <span className="settings-field-error">{error}</span> : null}
        </label>
    );
}

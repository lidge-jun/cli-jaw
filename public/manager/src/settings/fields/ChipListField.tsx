import { useState } from 'react';
import type { KeyboardEvent } from 'react';

type Props = {
    id: string;
    label: string;
    value: ReadonlyArray<string>;
    onChange: (next: string[]) => void;
    placeholder?: string;
    disabled?: boolean;
    error?: string | null;
};

export function ChipListField({
    id,
    label,
    value,
    onChange,
    placeholder,
    disabled,
    error,
}: Props) {
    const [draft, setDraft] = useState('');

    const commit = () => {
        const trimmed = draft.trim();
        if (!trimmed) return;
        if (value.includes(trimmed)) {
            setDraft('');
            return;
        }
        onChange([...value, trimmed]);
        setDraft('');
    };

    const remove = (chip: string) => {
        onChange(value.filter((v) => v !== chip));
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commit();
        } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
            const last = value[value.length - 1];
            if (last !== undefined) remove(last);
        }
    };

    return (
        <div className="settings-field settings-field-chiplist" aria-invalid={Boolean(error)}>
            <label className="settings-field-label" htmlFor={id}>
                {label}
            </label>
            <div className="settings-chiplist-row">
                {value.map((chip) => (
                    <span key={chip} className="settings-chip">
                        {chip}
                        <button
                            type="button"
                            className="settings-chip-remove"
                            disabled={disabled}
                            onClick={() => remove(chip)}
                            aria-label={`Remove ${chip}`}
                        >
                            ×
                        </button>
                    </span>
                ))}
                <input
                    id={id}
                    type="text"
                    value={draft}
                    placeholder={placeholder}
                    disabled={disabled}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={onKeyDown}
                    onBlur={commit}
                />
            </div>
            {error ? <span className="settings-field-error">{error}</span> : null}
        </div>
    );
}

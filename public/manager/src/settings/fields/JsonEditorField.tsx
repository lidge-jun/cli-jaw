import { useEffect, useState } from 'react';

type Props = {
    id: string;
    label: string;
    value: unknown;
    onChange: (next: unknown, valid: boolean) => void;
    disabled?: boolean;
    rows?: number;
};

export function JsonEditorField({ id, label, value, onChange, disabled, rows = 8 }: Props) {
    const [draft, setDraft] = useState(() => formatJson(value));
    const [parseError, setParseError] = useState<string | null>(null);

    useEffect(() => {
        setDraft(formatJson(value));
        setParseError(null);
    }, [value]);

    const apply = (text: string) => {
        setDraft(text);
        if (text.trim() === '') {
            setParseError(null);
            onChange(null, true);
            return;
        }
        try {
            const parsed = JSON.parse(text);
            setParseError(null);
            onChange(parsed, true);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Invalid JSON';
            setParseError(message);
            onChange(text, false);
        }
    };

    return (
        <label className="settings-field settings-field-json" htmlFor={id}>
            <span className="settings-field-label">{label}</span>
            <textarea
                id={id}
                value={draft}
                rows={rows}
                disabled={disabled}
                spellCheck={false}
                aria-invalid={Boolean(parseError)}
                onChange={(event) => apply(event.target.value)}
            />
            {parseError ? <span className="settings-field-error">{parseError}</span> : null}
        </label>
    );
}

function formatJson(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return '';
    }
}

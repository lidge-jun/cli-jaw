import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

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
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const selectedIndex = options.findIndex((opt) => opt.value === value);
    const selected = useMemo(
        () => options.find((opt) => opt.value === value) || options[0],
        [options, value],
    );
    const labelId = `${id}-label`;
    const listId = `${id}-listbox`;

    useEffect(() => {
        const onPointerDown = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        return () => document.removeEventListener('mousedown', onPointerDown);
    }, []);

    useEffect(() => {
        if (selectedIndex >= 0) setActiveIndex(selectedIndex);
    }, [selectedIndex]);

    const commit = (next: Option) => {
        onChange(next.value);
        setOpen(false);
    };

    const move = (delta: number) => {
        if (options.length === 0) return;
        setActiveIndex((current) => (current + delta + options.length) % options.length);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!open) setOpen(true);
            move(1);
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) setOpen(true);
            move(-1);
            return;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            setActiveIndex(0);
            return;
        }
        if (event.key === 'End') {
            event.preventDefault();
            setActiveIndex(Math.max(0, options.length - 1));
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (open && options[activeIndex]) commit(options[activeIndex]);
            else setOpen(true);
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
        }
    };

    return (
        <div className="settings-field settings-field-select" ref={rootRef}>
            <span className="settings-field-label" id={labelId}>{label}</span>
            <button
                id={id}
                type="button"
                className={`settings-select-trigger${open ? ' is-open' : ''}`}
                disabled={disabled || options.length === 0}
                role="combobox"
                aria-label={`${label}: ${selected?.label || '(none)'}`}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listId}
                aria-invalid={Boolean(error)}
                onClick={() => {
                    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
                    setOpen((next) => !next);
                }}
                onKeyDown={onKeyDown}
            >
                <span className="settings-select-value">{selected?.label || '(none)'}</span>
                <span className="settings-select-caret" aria-hidden="true" />
            </button>
            {open ? (
                <div className="settings-select-menu" id={listId} role="listbox" aria-labelledby={labelId}>
                    {options.map((opt, index) => (
                        <button
                            key={opt.value}
                            type="button"
                            role="option"
                            aria-selected={opt.value === value}
                            className={`settings-select-option${index === activeIndex ? ' is-active' : ''}${opt.value === value ? ' is-selected' : ''}`}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => commit(opt)}
                        >
                            <span>{opt.label}</span>
                            {opt.value === value ? <span aria-hidden="true">✓</span> : null}
                        </button>
                    ))}
                </div>
            ) : null}
            {error ? <span className="settings-field-error">{error}</span> : null}
        </div>
    );
}

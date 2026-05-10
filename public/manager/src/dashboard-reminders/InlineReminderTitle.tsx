import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { DashboardReminder } from './reminders-api';

type Props = {
    item: DashboardReminder;
    busy: boolean;
    onRename: (id: string, title: string) => void;
};

export function InlineReminderTitle(props: Props) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(props.item.title);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!editing) setDraft(props.item.title);
    }, [editing, props.item.title]);

    useEffect(() => {
        if (editing) inputRef.current?.select();
    }, [editing]);

    function commit(): void {
        const title = draft.trim();
        setEditing(false);
        if (!title || title === props.item.title) {
            setDraft(props.item.title);
            return;
        }
        props.onRename(props.item.id, title);
    }

    function cancel(): void {
        setDraft(props.item.title);
        setEditing(false);
    }

    function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
        if (event.key === 'Enter') {
            event.preventDefault();
            commit();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
        }
    }

    if (editing) {
        return (
            <input
                ref={inputRef}
                data-reminder-inline-edit="true"
                className="dashboard-reminders-inline-title-input"
                aria-label="Reminder title"
                disabled={props.busy}
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onBlur={commit}
                onClick={event => event.stopPropagation()}
                onDoubleClick={event => event.stopPropagation()}
                onKeyDown={handleKeyDown}
            />
        );
    }

    return (
        <span
            className="dashboard-reminders-inline-title"
            onDoubleClick={event => {
                event.preventDefault();
                event.stopPropagation();
                setEditing(true);
            }}
        >
            {props.item.title}
        </span>
    );
}

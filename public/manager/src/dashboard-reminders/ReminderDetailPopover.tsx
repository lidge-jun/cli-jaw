import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { DashboardReminder, DashboardReminderPatchInput } from './reminders-api';

type Props = {
    item: DashboardReminder | null;
    busy: boolean;
    onClose: () => void;
    onSave: (id: string, patch: DashboardReminderPatchInput) => void;
};

export function ReminderDetailPopover(props: Props) {
    const [title, setTitle] = useState('');
    const [notes, setNotes] = useState('');
    const [dueAt, setDueAt] = useState('');
    const [remindAt, setRemindAt] = useState('');

    useEffect(() => {
        setTitle(props.item?.title ?? '');
        setNotes(props.item?.notes ?? '');
        setDueAt(toLocalDateTime(props.item?.dueAt ?? null));
        setRemindAt(toLocalDateTime(props.item?.remindAt ?? null));
    }, [props.item]);

    useEffect(() => {
        if (!props.item) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') props.onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [props]);

    const changed = useMemo(() => {
        if (!props.item) return false;
        return (
            title.trim() !== props.item.title ||
            notes !== props.item.notes ||
            dueAt !== toLocalDateTime(props.item.dueAt) ||
            remindAt !== toLocalDateTime(props.item.remindAt)
        );
    }, [dueAt, notes, props.item, remindAt, title]);

    if (!props.item) return null;

    const item = props.item;

    const onSubmit = (event: FormEvent) => {
        event.preventDefault();
        if (!item) return;
        const nextTitle = title.trim();
        if (!nextTitle) return;
        const patch: DashboardReminderPatchInput = {};
        if (nextTitle !== item.title) patch.title = nextTitle;
        if (notes !== item.notes) patch.notes = notes;
        if (dueAt !== toLocalDateTime(item.dueAt)) patch.dueAt = fromLocalDateTime(dueAt);
        if (remindAt !== toLocalDateTime(item.remindAt)) patch.remindAt = fromLocalDateTime(remindAt);
        if (Object.keys(patch).length === 0) {
            props.onClose();
            return;
        }
        props.onSave(item.id, patch);
    };

    return (
        <div className="dashboard-reminder-popover-scrim" role="presentation" onMouseDown={props.onClose}>
            <section
                className="dashboard-reminder-popover"
                role="dialog"
                aria-modal="true"
                aria-label="Reminder details"
                onMouseDown={event => event.stopPropagation()}
            >
                <form onSubmit={onSubmit}>
                    <header>
                        <span>Reminder details</span>
                        <button type="button" aria-label="Close reminder details" onClick={props.onClose}>×</button>
                    </header>
                    <label>
                        <span>Title</span>
                        <input value={title} onChange={event => setTitle(event.target.value)} aria-label="Reminder title" />
                    </label>
                    <label>
                        <span>Notes</span>
                        <textarea value={notes} onChange={event => setNotes(event.target.value)} aria-label="Reminder notes" rows={6} />
                    </label>
                    <div className="dashboard-reminder-popover-grid">
                        <label>
                            <span>Due</span>
                            <input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} aria-label="Reminder due date" />
                        </label>
                        <label>
                            <span>Remind</span>
                            <input type="datetime-local" value={remindAt} onChange={event => setRemindAt(event.target.value)} aria-label="Reminder notification date" />
                        </label>
                    </div>
                    <footer>
                        <button type="button" onClick={props.onClose}>Cancel</button>
                        <button type="submit" disabled={props.busy || !title.trim() || !changed}>Save</button>
                    </footer>
                </form>
            </section>
        </div>
    );
}

function toLocalDateTime(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalDateTime(value: string): string | null {
    if (!value.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

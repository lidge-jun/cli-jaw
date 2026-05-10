import { useState, type DragEvent } from 'react';
import type { DashboardReminder } from './reminders-api';
import type { MatrixBucket } from './reminders-view-model';

const REMINDER_MIME = 'application/x-jaw-dashboard-reminder';

export type DashboardReminderDropTarget =
    | { kind: 'bucket'; bucket: MatrixBucket; beforeId: string | null; afterId: string | null }
    | { kind: 'priority'; beforeId: string | null; afterId: string | null };

function hasReminderDragType(event: DragEvent): boolean {
    return Array.from(event.dataTransfer.types).includes(REMINDER_MIME);
}

export function useDashboardReminderDrag(onDropReminder: (id: string, target: DashboardReminderDropTarget) => void) {
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<DashboardReminderDropTarget | null>(null);

    function start(item: DashboardReminder, event: DragEvent): void {
        if (event.target instanceof HTMLElement && event.target.closest('input, textarea, button, [data-reminder-inline-edit="true"]')) {
            event.preventDefault();
            return;
        }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(REMINDER_MIME, item.id);
        setDraggedId(item.id);
    }

    function over(target: DashboardReminderDropTarget, event: DragEvent): void {
        if (!hasReminderDragType(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget(target);
    }

    function leave(): void {
        setDropTarget(null);
    }

    function drop(target: DashboardReminderDropTarget, event: DragEvent): void {
        if (!hasReminderDragType(event)) return;
        event.preventDefault();
        const id = event.dataTransfer.getData(REMINDER_MIME);
        setDraggedId(null);
        setDropTarget(null);
        if (id) onDropReminder(id, target);
    }

    function end(): void {
        setDraggedId(null);
        setDropTarget(null);
    }

    return { draggedId, dropTarget, start, over, leave, drop, end };
}

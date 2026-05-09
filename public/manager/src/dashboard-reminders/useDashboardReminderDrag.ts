import { useState, type DragEvent } from 'react';
import type { DashboardReminder } from './reminders-api';
import type { MatrixBucket } from './reminders-view-model';

const REMINDER_MIME = 'application/x-jaw-dashboard-reminder';

function hasReminderDragType(event: DragEvent): boolean {
    return Array.from(event.dataTransfer.types).includes(REMINDER_MIME);
}

export function useDashboardReminderDrag(onDropBucket: (id: string, bucket: MatrixBucket) => void) {
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dropBucket, setDropBucket] = useState<MatrixBucket | null>(null);

    function start(item: DashboardReminder, event: DragEvent): void {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(REMINDER_MIME, item.id);
        setDraggedId(item.id);
    }

    function over(bucket: MatrixBucket, event: DragEvent): void {
        if (!hasReminderDragType(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropBucket(bucket);
    }

    function leave(bucket: MatrixBucket): void {
        setDropBucket(current => current === bucket ? null : current);
    }

    function drop(bucket: MatrixBucket, event: DragEvent): void {
        if (!hasReminderDragType(event)) return;
        event.preventDefault();
        const id = event.dataTransfer.getData(REMINDER_MIME);
        setDraggedId(null);
        setDropBucket(null);
        if (id) onDropBucket(id, bucket);
    }

    function end(): void {
        setDraggedId(null);
        setDropBucket(null);
    }

    return { draggedId, dropBucket, start, over, leave, drop, end };
}

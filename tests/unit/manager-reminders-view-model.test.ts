import assert from 'node:assert/strict';
import test from 'node:test';

import type { DashboardReminder } from '../../public/manager/src/dashboard-reminders/reminders-api.ts';
import {
    MATRIX_SECTIONS,
    matrixBucketToPatch,
    matrixItems,
    rankTopPriorityItems,
    remindersForView,
} from '../../public/manager/src/dashboard-reminders/reminders-view-model.ts';

function reminder(partial: Partial<DashboardReminder> & { id: string; title?: string }): DashboardReminder {
    return {
        id: partial.id,
        title: partial.title ?? partial.id,
        notes: partial.notes ?? '',
        listId: partial.listId ?? 'today',
        status: partial.status ?? 'open',
        priority: partial.priority ?? 'normal',
        dueAt: partial.dueAt ?? null,
        remindAt: partial.remindAt ?? null,
        linkedInstance: partial.linkedInstance ?? null,
        subtasks: partial.subtasks ?? [],
        source: 'dashboard',
        sourceCreatedAt: partial.sourceCreatedAt ?? '2026-05-09T00:00:00.000Z',
        sourceUpdatedAt: partial.sourceUpdatedAt ?? '2026-05-09T00:00:00.000Z',
        mirroredAt: partial.mirroredAt ?? '2026-05-09T00:00:00.000Z',
        notificationStatus: partial.notificationStatus ?? 'pending',
        notificationAttemptedAt: partial.notificationAttemptedAt ?? null,
        notificationError: partial.notificationError ?? null,
        instanceId: partial.instanceId ?? null,
        messageId: partial.messageId ?? null,
        turnIndex: partial.turnIndex ?? null,
        port: partial.port ?? null,
        threadKey: partial.threadKey ?? null,
        sourceText: partial.sourceText ?? null,
    };
}

test('matrix and done views are disjoint global sidebar sets', () => {
    const items = [
        reminder({ id: 'high', priority: 'high' }),
        reminder({ id: 'important', priority: 'normal' }),
        reminder({ id: 'waiting', status: 'waiting' }),
        reminder({ id: 'later', listId: 'later', priority: 'low' }),
        reminder({ id: 'done', status: 'done', priority: 'high' }),
    ];

    assert.deepEqual(remindersForView('matrix', items).map(item => item.id), ['high', 'important', 'waiting', 'later']);
    assert.deepEqual(remindersForView('done', items).map(item => item.id), ['done']);
});

test('matrix buckets partition the matrix set exactly once', () => {
    const items = [
        reminder({ id: 'focused', status: 'focused', priority: 'low', listId: 'later' }),
        reminder({ id: 'high', priority: 'high' }),
        reminder({ id: 'important', priority: 'normal' }),
        reminder({ id: 'waiting', status: 'waiting' }),
        reminder({ id: 'later', listId: 'later', priority: 'low' }),
        reminder({ id: 'done', status: 'done' }),
    ];
    const matrixIds = remindersForView('matrix', items).map(item => item.id).sort();
    const bucketIds = MATRIX_SECTIONS
        .flatMap(section => matrixItems(section.id, items).map(item => item.id))
        .sort();

    assert.deepEqual(bucketIds, matrixIds);
});

test('matrix bucket patches map movement targets to dashboard reminder patches', () => {
    assert.deepEqual(matrixBucketToPatch('urgentImportant'), { listId: 'today', status: 'open', priority: 'high' });
    assert.deepEqual(matrixBucketToPatch('important'), { listId: 'today', status: 'open', priority: 'normal' });
    assert.deepEqual(matrixBucketToPatch('waiting'), { listId: 'waiting', status: 'waiting', priority: 'normal' });
    assert.deepEqual(matrixBucketToPatch('later'), { listId: 'later', status: 'open', priority: 'low' });
});

test('top priority ranks focused, due time, priority, then creation time', () => {
    const items = [
        reminder({ id: 'old-normal', priority: 'normal', sourceCreatedAt: '2026-05-09T00:00:00.000Z' }),
        reminder({ id: 'due-high', priority: 'high', dueAt: '2026-05-10T03:00:00.000Z', sourceCreatedAt: '2026-05-09T01:00:00.000Z' }),
        reminder({ id: 'remind-low', priority: 'low', remindAt: '2026-05-10T01:00:00.000Z', sourceCreatedAt: '2026-05-09T02:00:00.000Z' }),
        reminder({ id: 'focused', status: 'focused', priority: 'low', sourceCreatedAt: '2026-05-09T03:00:00.000Z' }),
        reminder({ id: 'done', status: 'done', priority: 'high', dueAt: '2026-05-10T00:00:00.000Z' }),
    ];

    assert.deepEqual(rankTopPriorityItems(items, 3).map(item => item.id), ['focused', 'remind-low', 'due-high']);
});

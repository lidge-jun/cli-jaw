import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { RemindersStore } from '../../src/manager/reminders/store.js';
import type { ReminderSnapshot } from '../../src/reminders/types.js';

const SNAPSHOT: ReminderSnapshot = {
    schemaVersion: 1,
    lists: [{ id: 'today', name: 'Today', accent: '#0a84ff' }],
    reminders: [
        {
            id: 'rem_1',
            title: 'Follow up',
            notes: 'Call clinic',
            listId: 'today',
            status: 'open',
            priority: 'high',
            dueAt: '2026-05-09T03:00:00.000Z',
            remindAt: '2026-05-09T02:30:00.000Z',
            linkedInstance: null,
            subtasks: [{ id: 'sub_1', title: 'Find chart', done: false }],
            createdAt: '2026-05-08T12:00:00.000Z',
            updatedAt: '2026-05-08T12:10:00.000Z',
        },
    ],
};

test('RemindersStore mirrors jaw-reminders snapshots into dashboard rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-jaw-reminders-store-'));
    try {
        const store = new RemindersStore({ dbPath: join(dir, 'dashboard.db') });
        const changes = store.upsertFromSnapshot(SNAPSHOT, '2026-05-08T12:11:00.000Z');
        assert.equal(changes, 1);

        const reminders = store.list();
        assert.equal(reminders.length, 1);
        assert.equal(reminders[0]?.id, 'rem_1');
        assert.equal(reminders[0]?.title, 'Follow up');
        assert.equal(reminders[0]?.priority, 'high');
        assert.equal(reminders[0]?.source, 'jaw-reminders');
        assert.equal(reminders[0]?.notificationStatus, 'pending');
        assert.equal(reminders[0]?.subtasks[0]?.title, 'Find chart');

        const updated = store.markNotificationAttempt('rem_1', 'no_channel', 'No active channel', '2026-05-08T12:12:00.000Z');
        assert.equal(updated?.notificationStatus, 'no_channel');
        assert.equal(updated?.notificationError, 'No active channel');
        assert.equal(updated?.notificationAttemptedAt, '2026-05-08T12:12:00.000Z');
        store.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('RemindersStore creates and updates cli-jaw-local message reminders with link metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-jaw-reminders-local-'));
    try {
        const store = new RemindersStore({ dbPath: join(dir, 'dashboard.db') });
        const created = store.createLocal({
            title: 'Pin this answer',
            notes: 'message body',
            priority: 'high',
            link: {
                instanceId: 'port:24576',
                messageId: 'msg-1',
                turnIndex: 3,
                port: 24576,
                threadKey: 'thread-a',
                sourceText: 'message body',
            },
        });
        assert.equal(created.source, 'cli-jaw-local');
        assert.equal(created.instanceId, 'port:24576');
        assert.equal(created.messageId, 'msg-1');
        assert.equal(created.turnIndex, 3);
        assert.equal(created.port, 24576);
        assert.equal(created.threadKey, 'thread-a');

        const updated = store.updateLocal(created.id, { status: 'done' });
        assert.equal(updated?.status, 'done');
        store.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('RemindersStore prunes stale jaw-reminders rows and resets notifications when schedule changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-jaw-reminders-sync-'));
    try {
        const store = new RemindersStore({ dbPath: join(dir, 'dashboard.db') });
        store.upsertFromSnapshot(SNAPSHOT, '2026-05-08T12:11:00.000Z');
        const local = store.createLocal({ title: 'Local pin', link: { instanceId: 'port:1', messageId: 'msg-1', port: 1 } });
        store.markNotificationAttempt('rem_1', 'delivered', null, '2026-05-08T12:12:00.000Z');

        const updatedSnapshot: ReminderSnapshot = {
            ...SNAPSHOT,
            reminders: [{
                ...SNAPSHOT.reminders[0]!,
                remindAt: '2026-05-09T04:00:00.000Z',
                updatedAt: '2026-05-08T12:13:00.000Z',
            }],
        };
        store.upsertFromSnapshot(updatedSnapshot, '2026-05-08T12:14:00.000Z');
        assert.equal(store.get('rem_1')?.notificationStatus, 'pending');
        assert.equal(store.get('rem_1')?.notificationAttemptedAt, null);

        store.upsertFromSnapshot({ ...SNAPSHOT, reminders: [] }, '2026-05-08T12:15:00.000Z');
        assert.equal(store.get('rem_1'), null);
        assert.equal(store.get(local.id)?.source, 'cli-jaw-local');
        store.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('RemindersStore resets local notification state when a local reminder is rescheduled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-jaw-reminders-local-reset-'));
    try {
        const store = new RemindersStore({ dbPath: join(dir, 'dashboard.db') });
        const created = store.createLocal({
            title: 'Local alarm',
            remindAt: '2026-05-09T01:00:00.000Z',
            link: { instanceId: 'port:1', messageId: 'msg-1', port: 1 },
        });
        store.markNotificationAttempt(created.id, 'failed', 'transport', '2026-05-09T01:00:01.000Z');
        const updated = store.updateLocal(created.id, { remindAt: '2026-05-09T02:00:00.000Z' });
        assert.equal(updated?.notificationStatus, 'pending');
        assert.equal(updated?.notificationAttemptedAt, null);
        assert.equal(updated?.notificationError, null);
        store.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('RemindersStore resets notification state when done reminders are reopened with a new schedule', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-jaw-reminders-reopen-reset-'));
    try {
        const store = new RemindersStore({ dbPath: join(dir, 'dashboard.db') });
        const created = store.createLocal({
            title: 'Reopen local alarm',
            status: 'done',
            remindAt: '2026-05-09T01:00:00.000Z',
            link: { instanceId: 'port:1', messageId: 'msg-1', port: 1 },
        });
        store.markNotificationAttempt(created.id, 'delivered', null, '2026-05-09T01:00:01.000Z');
        const updated = store.updateLocal(created.id, { status: 'open', remindAt: '2026-05-09T02:00:00.000Z' });
        assert.equal(updated?.notificationStatus, 'pending');
        assert.equal(updated?.notificationAttemptedAt, null);

        const doneSnapshot: ReminderSnapshot = {
            ...SNAPSHOT,
            reminders: [{ ...SNAPSHOT.reminders[0]!, status: 'done', remindAt: '2026-05-09T01:00:00.000Z' }],
        };
        store.upsertFromSnapshot(doneSnapshot, '2026-05-09T01:00:00.000Z');
        store.markNotificationAttempt('rem_1', 'delivered', null, '2026-05-09T01:00:01.000Z');
        const reopenedSnapshot: ReminderSnapshot = {
            ...SNAPSHOT,
            reminders: [{ ...SNAPSHOT.reminders[0]!, status: 'open', remindAt: '2026-05-09T02:00:00.000Z' }],
        };
        store.upsertFromSnapshot(reopenedSnapshot, '2026-05-09T02:00:00.000Z');
        assert.equal(store.get('rem_1')?.notificationStatus, 'pending');
        assert.equal(store.get('rem_1')?.notificationAttemptedAt, null);
        store.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('RemindersStore migrates legacy mirror rows with notification/link columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-jaw-reminders-legacy-'));
    try {
        const dbPath = join(dir, 'dashboard.db');
        const db = new Database(dbPath);
        db.exec(`
            CREATE TABLE dashboard_reminders (
                id                 TEXT PRIMARY KEY,
                title              TEXT NOT NULL,
                notes              TEXT NOT NULL DEFAULT '',
                list_id            TEXT NOT NULL,
                status             TEXT NOT NULL,
                priority           TEXT NOT NULL,
                due_at             TEXT,
                remind_at          TEXT,
                linked_instance    TEXT,
                subtasks_json      TEXT NOT NULL DEFAULT '[]',
                source             TEXT NOT NULL DEFAULT 'jaw-reminders',
                source_created_at  TEXT NOT NULL,
                source_updated_at  TEXT NOT NULL,
                mirrored_at        TEXT NOT NULL
            );
        `);
        db.prepare(`
            INSERT INTO dashboard_reminders (
                id, title, list_id, status, priority, source_created_at, source_updated_at, mirrored_at
            )
            VALUES ('legacy', 'Legacy', 'today', 'open', 'normal', '2026-05-08T00:00:00.000Z', '2026-05-08T00:00:00.000Z', '2026-05-08T00:00:01.000Z')
        `).run();
        db.close();

        const store = new RemindersStore({ dbPath });
        const row = store.get('legacy');
        assert.equal(row?.notificationStatus, 'pending');
        assert.equal(row?.instanceId, null);
        assert.equal(row?.messageId, null);
        store.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

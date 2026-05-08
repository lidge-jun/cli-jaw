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

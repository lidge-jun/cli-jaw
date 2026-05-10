import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { RemindersStore } from '../../src/manager/reminders/store.js';

test('RemindersStore creates and updates dashboard reminders with optional link metadata', () => {
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
        assert.equal(created.source, 'dashboard');
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

        store.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('RemindersStore persists manual rank and sorts ranked reminders before unranked fallbacks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-jaw-reminders-rank-'));
    try {
        const store = new RemindersStore({ dbPath: join(dir, 'dashboard.db') });
        const unranked = store.createLocal({ title: 'Unranked', priority: 'high' });
        const second = store.createLocal({ title: 'Second', priority: 'normal', manualRank: 2000 });
        const first = store.createLocal({ title: 'First', priority: 'low', manualRank: 1000 });
        assert.equal(store.get(second.id)?.manualRank, 2000);

        const updated = store.updateLocal(unranked.id, { manualRank: 500 });
        assert.equal(updated?.manualRank, 500);
        assert.deepEqual(store.list().slice(0, 3).map(item => item.id), [unranked.id, first.id, second.id]);
        store.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('RemindersStore migrates legacy reminder rows with notification/link columns and dashboard source', () => {
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
        assert.equal(row?.manualRank, null);
        assert.equal(row?.instanceId, null);
        assert.equal(row?.messageId, null);
        assert.equal(row?.source, 'dashboard');
        store.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

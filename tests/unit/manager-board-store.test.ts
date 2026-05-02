import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { BoardStore } from '../../src/manager/board/store.js';

test('BoardStore persists editable title, summary, and markdown detail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-jaw-board-'));
    try {
        const store = new BoardStore({ dbPath: join(dir, 'dashboard.db') });
        const created = store.create({
            title: 'Initial title',
            summary: 'One-line memo',
            detail: '## Details\n\n- markdown item',
            lane: 'backlog',
        });

        assert.equal(created.title, 'Initial title');
        assert.equal(created.summary, 'One-line memo');
        assert.equal(created.detail, '## Details\n\n- markdown item');

        const updated = store.update(created.id, {
            title: 'Updated title',
            summary: 'Updated memo',
            detail: '### Updated\n\nFull text',
        });

        assert.equal(updated?.title, 'Updated title');
        assert.equal(updated?.summary, 'Updated memo');
        assert.equal(updated?.detail, '### Updated\n\nFull text');
        store.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('BoardStore migrates legacy board lane names to standard workflow lanes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-jaw-board-legacy-'));
    try {
        const dbPath = join(dir, 'dashboard.db');
        const db = new Database(dbPath);
        db.exec(`
            CREATE TABLE dashboard_tasks (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL,
                lane        TEXT NOT NULL DEFAULT 'inbox',
                port        INTEGER,
                thread_key  TEXT,
                note_path   TEXT,
                source      TEXT NOT NULL DEFAULT 'user',
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
        `);
        db.prepare("INSERT INTO dashboard_tasks (id, title, lane) VALUES ('a', 'Old inbox', 'inbox')").run();
        db.prepare("INSERT INTO dashboard_tasks (id, title, lane) VALUES ('b', 'Old doing', 'doing')").run();
        db.prepare("INSERT INTO dashboard_tasks (id, title, lane) VALUES ('c', 'Old blocked', 'blocked')").run();
        db.close();

        const store = new BoardStore({ dbPath });
        const lanes = new Map(store.list().map(task => [task.id, task.lane]));
        assert.equal(lanes.get('a'), 'backlog');
        assert.equal(lanes.get('b'), 'active');
        assert.equal(lanes.get('c'), 'active');
        store.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

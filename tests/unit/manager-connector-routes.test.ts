import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDashboardConnectorRouter } from '../../src/manager/connector/routes.js';
import { ConnectorAuditLog } from '../../src/manager/connector/audit-log.js';
import { BoardStore } from '../../src/manager/board/store.js';
import { RemindersStore } from '../../src/manager/reminders/store.js';
import { NotesStore } from '../../src/manager/notes/store.js';

type ConnectorContext = {
    baseUrl: string;
    audit: ConnectorAuditLog;
};

async function withConnectorServer(fn: (ctx: ConnectorContext) => Promise<void>): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'cli-jaw-connector-routes-'));
    const dbPath = join(dir, 'dashboard.db');
    const boardStore = new BoardStore({ dbPath });
    const remindersStore = new RemindersStore({ dbPath });
    const notesStore = new NotesStore({ root: join(dir, 'notes') });
    const auditLog = new ConnectorAuditLog({ dbPath });

    const app = express();
    app.use(express.json());
    app.use(
        '/api/dashboard/connector',
        createDashboardConnectorRouter({ boardStore, remindersStore, notesStore, auditLog }),
    );
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address();
        assert.equal(typeof address, 'object');
        assert.ok(address);
        await fn({ baseUrl: `http://127.0.0.1:${address.port}`, audit: auditLog });
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
        boardStore.close();
        remindersStore.close();
        auditLog.close();
        rmSync(dir, { recursive: true, force: true });
    }
}

test('POST /board without userRequested:true is rejected with 403', async () => {
    await withConnectorServer(async ({ baseUrl, audit }) => {
        const res = await fetch(`${baseUrl}/api/dashboard/connector/board`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'should fail' }),
        });
        assert.equal(res.status, 403);
        const body = await res.json() as { code: string };
        assert.equal(body.code, 'connector_not_user_requested');
        assert.equal(audit.list().length, 0);
    });
});

test('POST /board with userRequested:true creates a task and records audit', async () => {
    await withConnectorServer(async ({ baseUrl, audit }) => {
        const res = await fetch(`${baseUrl}/api/dashboard/connector/board`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                userRequested: true,
                title: 'Kanban via connector',
                lane: 'backlog',
                instanceLink: { port: 24576, threadKey: 't-1', messageId: 'm-99' },
            }),
        });
        assert.equal(res.status, 201);
        const body = await res.json() as {
            ok: boolean;
            task: { id: string; title: string; lane: string };
        };
        assert.equal(body.ok, true);
        assert.equal(body.task.title, 'Kanban via connector');
        assert.equal(body.task.lane, 'backlog');
        const events = audit.list();
        assert.equal(events.length, 1);
        assert.equal(events[0]?.surface, 'board');
        assert.equal(events[0]?.action, 'create');
        assert.equal(events[0]?.targetId, body.task.id);
        assert.equal(events[0]?.instanceLink?.port, 24576);
    });
});

test('POST /reminders with userRequested:true creates a reminder and records audit', async () => {
    await withConnectorServer(async ({ baseUrl, audit }) => {
        const res = await fetch(`${baseUrl}/api/dashboard/connector/reminders`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                userRequested: true,
                title: 'Tomorrow 9am ping',
                priority: 'high',
                remindAt: new Date(Date.now() + 86400000).toISOString(),
            }),
        });
        assert.equal(res.status, 201);
        const body = await res.json() as {
            reminder: { id: string; title: string; priority: string };
        };
        assert.equal(body.reminder.title, 'Tomorrow 9am ping');
        assert.equal(body.reminder.priority, 'high');
        const events = audit.list();
        assert.equal(events.length, 1);
        assert.equal(events[0]?.surface, 'reminders');
    });
});

test('POST /notes with a safe path writes and records audit', async () => {
    await withConnectorServer(async ({ baseUrl, audit }) => {
        const res = await fetch(`${baseUrl}/api/dashboard/connector/notes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                userRequested: true,
                path: 'connector/test-note.md',
                body: '# Hello\n\nFrom connector.',
            }),
        });
        assert.equal(res.status, 201);
        const body = await res.json() as { note: { path: string } };
        assert.equal(body.note.path, 'connector/test-note.md');
        const events = audit.list();
        assert.equal(events.length, 1);
        assert.equal(events[0]?.surface, 'notes');
        assert.equal(events[0]?.action, 'write');
    });
});

test('POST /notes with unsafe path is rejected with 400 and no audit row', async () => {
    await withConnectorServer(async ({ baseUrl, audit }) => {
        const res = await fetch(`${baseUrl}/api/dashboard/connector/notes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                userRequested: true,
                path: '../../etc/passwd',
                body: 'bad',
            }),
        });
        assert.equal(res.status, 400);
        assert.equal(audit.list().length, 0);
    });
});

test('GET /audit returns recent events without requiring userRequested', async () => {
    await withConnectorServer(async ({ baseUrl }) => {
        await fetch(`${baseUrl}/api/dashboard/connector/board`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ userRequested: true, title: 'Seed' }),
        });
        const res = await fetch(`${baseUrl}/api/dashboard/connector/audit?limit=10`);
        assert.equal(res.status, 200);
        const body = await res.json() as { events: Array<{ surface: string }> };
        assert.equal(body.events.length, 1);
        assert.equal(body.events[0]?.surface, 'board');
    });
});

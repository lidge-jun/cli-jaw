import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDashboardRemindersRouter } from '../../src/manager/reminders/routes.js';
import { RemindersStore } from '../../src/manager/reminders/store.js';
import type { ReminderSnapshot } from '../../src/reminders/types.js';

const SNAPSHOT: ReminderSnapshot = {
    schemaVersion: 1,
    lists: [{ id: 'today', name: 'Today', accent: '#0a84ff' }],
    reminders: [
        {
            id: 'route_rem_1',
            title: 'Route mirror',
            notes: '',
            listId: 'today',
            status: 'focused',
            priority: 'normal',
            dueAt: null,
            remindAt: null,
            linkedInstance: '24576',
            subtasks: [],
            createdAt: '2026-05-08T00:00:00.000Z',
            updatedAt: '2026-05-08T00:00:00.000Z',
        },
    ],
};

async function withRemindersServer(
    sourcePath: string,
    fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'cli-jaw-reminders-routes-'));
    const store = new RemindersStore({ dbPath: join(dir, 'dashboard.db') });
    const app = express();
    const server = http.createServer(app);
    app.use(express.json());
    app.use('/api/dashboard/reminders', createDashboardRemindersRouter({ store, sourcePath }));

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address();
        assert.equal(typeof address, 'object');
        assert.ok(address);
        await fn(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
        store.close();
        rmSync(dir, { recursive: true, force: true });
    }
}

test('reminders routes refresh the mirror from an injected snapshot path', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'cli-jaw-reminders-source-'));
    try {
        const sourcePath = join(sourceDir, 'reminders.json');
        writeFileSync(sourcePath, JSON.stringify(SNAPSHOT), 'utf8');
        await withRemindersServer(sourcePath, async (baseUrl) => {
            const refreshed = await fetch(`${baseUrl}/api/dashboard/reminders/refresh`, { method: 'POST' });
            assert.equal(refreshed.status, 200);
            const refreshedBody = await refreshed.json() as {
                ok: boolean;
                items?: Array<{ id: string; title: string }>;
                sourceStatus?: { ok: boolean; reminders?: number };
            };
            assert.equal(refreshedBody.ok, true);
            assert.equal(refreshedBody.sourceStatus?.ok, true);
            assert.equal(refreshedBody.sourceStatus?.reminders, 1);
            assert.equal(refreshedBody.items?.[0]?.title, 'Route mirror');

            const listed = await fetch(`${baseUrl}/api/dashboard/reminders`);
            assert.equal(listed.status, 200);
            const listedBody = await listed.json() as {
                ok: boolean;
                items?: Array<{ id: string; linkedInstance: string | null }>;
            };
            assert.equal(listedBody.ok, true);
            assert.equal(listedBody.items?.[0]?.id, 'route_rem_1');
            assert.equal(listedBody.items?.[0]?.linkedInstance, '24576');
        });
    } finally {
        rmSync(sourceDir, { recursive: true, force: true });
    }
});

test('reminders routes surface missing source files as typed non-fatal statuses', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'cli-jaw-reminders-missing-'));
    try {
        const sourcePath = join(sourceDir, 'missing.json');
        await withRemindersServer(sourcePath, async (baseUrl) => {
            const refreshed = await fetch(`${baseUrl}/api/dashboard/reminders?refresh=1`);
            assert.equal(refreshed.status, 200);
            const body = await refreshed.json() as {
                ok: boolean;
                items?: unknown[];
                sourceStatus?: { ok: boolean; code?: string };
            };
            assert.equal(body.ok, true);
            assert.equal(Array.isArray(body.items), true);
            assert.equal(body.sourceStatus?.ok, false);
            assert.equal(body.sourceStatus?.code, 'missing_file');
        });
    } finally {
        rmSync(sourceDir, { recursive: true, force: true });
    }
});

test('reminders from-message route creates local linked reminders and allows local status updates', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'cli-jaw-reminders-from-message-'));
    try {
        await withRemindersServer(join(sourceDir, 'missing.json'), async (baseUrl) => {
            const created = await fetch(`${baseUrl}/api/dashboard/reminders/from-message`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    title: 'Pin from chat',
                    notes: 'chat text',
                    priority: 'high',
                    port: 24576,
                    instanceId: 'port:24576',
                    messageId: 'msg-42',
                    turnIndex: 4,
                    threadKey: 'thread-key',
                }),
            });
            assert.equal(created.status, 201);
            const createdBody = await created.json() as { item: { id: string; source: string; messageId: string; port: number } };
            assert.equal(createdBody.item.source, 'cli-jaw-local');
            assert.equal(createdBody.item.messageId, 'msg-42');
            assert.equal(createdBody.item.port, 24576);

            const patched = await fetch(`${baseUrl}/api/dashboard/reminders/${createdBody.item.id}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ status: 'done' }),
            });
            assert.equal(patched.status, 200);
            const patchedBody = await patched.json() as { item: { status: string } };
            assert.equal(patchedBody.item.status, 'done');
        });
    } finally {
        rmSync(sourceDir, { recursive: true, force: true });
    }
});

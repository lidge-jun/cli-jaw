import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDashboardWorkspaceRouter } from '../../src/manager/workspace/routes.js';
import { WorkspaceStore } from '../../src/manager/workspace/store.js';

async function withWorkspaceServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'cli-jaw-workspace-routes-'));
    const store = new WorkspaceStore({ dbPath: join(dir, 'dashboard.db') });
    const app = express();
    const server = http.createServer(app);
    app.use(express.json());
    app.use('/api/dashboard/workspace', createDashboardWorkspaceRouter({ store }));

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address();
        assert.equal(typeof address, 'object');
        assert.ok(address);
        await fn(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        store.close();
        rmSync(dir, { recursive: true, force: true });
    }
}

test('workspace routes create, move, link, and snapshot items', async () => {
    await withWorkspaceServer(async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/dashboard/workspace/items`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'Agent managed item',
                boardLane: 'active',
                matrixBucket: 'urgentImportant',
                actor: 'agent',
            }),
        });
        assert.equal(created.status, 201);
        const createdBody = await created.json() as { item: { id: string; revision: number } };

        const moved = await fetch(`${baseUrl}/api/dashboard/workspace/items/${createdBody.item.id}/move`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ boardLane: 'review', matrixBucket: 'important', revision: createdBody.item.revision }),
        });
        assert.equal(moved.status, 200);
        const movedBody = await moved.json() as { item: { revision: number; boardLane: string; matrixBucket: string } };
        assert.equal(movedBody.item.boardLane, 'review');
        assert.equal(movedBody.item.matrixBucket, 'important');

        const linked = await fetch(`${baseUrl}/api/dashboard/workspace/items/${createdBody.item.id}/link-note`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: 'notes/workspace.md', revision: movedBody.item.revision }),
        });
        assert.equal(linked.status, 200);

        const snapshot = await fetch(`${baseUrl}/api/dashboard/workspace/snapshot`);
        assert.equal(snapshot.status, 200);
        const snapshotBody = await snapshot.json() as {
            ok: boolean;
            items: unknown[];
            board: Record<string, unknown[]>;
            matrix: Record<string, unknown[]>;
            events: unknown[];
        };
        assert.equal(snapshotBody.ok, true);
        assert.equal(snapshotBody.items.length, 1);
        assert.equal(snapshotBody.board.review.length, 1);
        assert.equal(snapshotBody.matrix.important.length, 1);
        assert.ok(snapshotBody.events.length >= 3);
    });
});

test('workspace routes reject invalid titles, unsafe notes, and stale revisions', async () => {
    await withWorkspaceServer(async (baseUrl) => {
        const invalid = await fetch(`${baseUrl}/api/dashboard/workspace/items`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: '' }),
        });
        assert.equal(invalid.status, 400);

        const created = await fetch(`${baseUrl}/api/dashboard/workspace/items`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Guard me' }),
        });
        assert.equal(created.status, 201);
        const body = await created.json() as { item: { id: string; revision: number } };

        const stale = await fetch(`${baseUrl}/api/dashboard/workspace/items/${body.item.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'Stale', revision: body.item.revision + 1 }),
        });
        assert.equal(stale.status, 409);

        const unsafe = await fetch(`${baseUrl}/api/dashboard/workspace/items/${body.item.id}/link-note`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: '../private.md', revision: body.item.revision }),
        });
        assert.equal(unsafe.status, 400);

        const invalidStatus = await fetch(`${baseUrl}/api/dashboard/workspace/items/${body.item.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'started', revision: body.item.revision }),
        });
        assert.equal(invalidStatus.status, 400);

        const invalidBucket = await fetch(`${baseUrl}/api/dashboard/workspace/items/${body.item.id}/move`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ matrixBucket: 'q5', revision: body.item.revision }),
        });
        assert.equal(invalidBucket.status, 400);
    });
});

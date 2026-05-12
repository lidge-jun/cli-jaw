import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WorkspaceRevisionError, WorkspaceStore } from '../../src/manager/workspace/store.js';

function withStore(fn: (store: WorkspaceStore) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'cli-jaw-workspace-store-'));
    const store = new WorkspaceStore({ dbPath: join(dir, 'dashboard.db') });
    try {
        fn(store);
    } finally {
        store.close();
        rmSync(dir, { recursive: true, force: true });
    }
}

test('WorkspaceStore creates work items and projects board/matrix snapshot', () => {
    withStore((store) => {
        const item = store.createItem({
            title: 'Write agent workspace plan',
            body: 'Unify notes, board, matrix, reminders.',
            status: 'active',
            priority: 'high',
            matrixBucket: 'urgentImportant',
            boardLane: 'doing',
            notePaths: ['projects/workspace.md'],
            actor: 'agent',
        });

        assert.equal(item.revision, 1);
        assert.equal(item.createdBy, 'agent');
        assert.deepEqual(store.snapshot().board.doing?.map(entry => entry.id), [item.id]);
        assert.deepEqual(store.snapshot().matrix.urgentImportant.map(entry => entry.id), [item.id]);
        assert.equal(store.listEvents()[0]?.kind, 'item-created');
    });
});

test('WorkspaceStore rejects stale revisions and records successful updates', () => {
    withStore((store) => {
        const item = store.createItem({ title: 'Move me' });
        assert.throws(
            () => store.updateItem(item.id, { title: 'Stale', revision: item.revision + 1 }),
            WorkspaceRevisionError,
        );

        const updated = store.updateItem(item.id, { title: 'Fresh', revision: item.revision, actor: 'human' });
        assert.equal(updated?.title, 'Fresh');
        assert.equal(updated?.revision, 2);
        assert.equal(updated?.updatedBy, 'human');
    });
});

test('WorkspaceStore moves items and links notes plus instance context', () => {
    withStore((store) => {
        const item = store.createItem({ title: 'Connect context' });
        const moved = store.moveItem(item.id, {
            boardLane: 'review',
            matrixBucket: 'important',
            status: 'review',
            revision: item.revision,
        });
        assert.equal(moved?.boardLane, 'review');
        assert.equal(moved?.matrixBucket, 'important');
        assert.equal(moved?.status, 'review');

        const noteLinked = store.linkNote(item.id, 'notes/review.md', moved?.revision);
        assert.deepEqual(noteLinked?.notePaths, ['notes/review.md']);

        const instanceLinked = store.linkInstance(item.id, {
            instanceId: 'port:24576',
            port: 24576,
            messageId: 'msg-1',
            turnIndex: 2,
            threadKey: 'thread-a',
        }, noteLinked?.revision);
        assert.equal(instanceLinked?.instanceLinks[0]?.port, 24576);
        assert.ok(store.listEvents().some(event => event.kind === 'note-linked'));
        assert.ok(store.listEvents().some(event => event.kind === 'instance-linked'));
    });
});

test('WorkspaceStore rejects unsafe note paths', () => {
    withStore((store) => {
        const item = store.createItem({ title: 'Unsafe path guard' });
        assert.throws(() => store.linkNote(item.id, '../secrets.md'), /unsafe note path/);
        assert.throws(() => store.createItem({ title: 'Bad note', notePaths: ['/tmp/secret.md'] }), /unsafe note path/);
    });
});

test('WorkspaceStore rejects invalid enum and instance link values', () => {
    withStore((store) => {
        const item = store.createItem({ title: 'Strict values' });
        assert.throws(() => store.updateItem(item.id, { status: 'started' as never }), /invalid status/);
        assert.throws(() => store.updateItem(item.id, { matrixBucket: 'q5' as never }), /invalid matrixBucket/);
        assert.throws(() => store.linkInstance(item.id, {
            instanceId: 'bad-port',
            port: -1,
            messageId: null,
            turnIndex: 0,
            threadKey: null,
        }), /port must be an integer >= 1/);
    });
});

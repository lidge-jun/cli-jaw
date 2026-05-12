import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { normalizeWorkspaceItem } from '../../public/manager/src/workspace/workspace-api.ts';
import type { DashboardWorkspaceItem } from '../../public/manager/src/workspace/workspace-types.ts';
import {
    itemsForInstance,
    itemsForNote,
    itemsToBoardLanes,
    itemsToMatrixBuckets,
    itemsToTopPriority,
} from '../../public/manager/src/workspace/workspace-projections.ts';

const projectRoot = process.cwd();

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

function item(partial: Partial<DashboardWorkspaceItem> & { id: string; title?: string }): DashboardWorkspaceItem {
    return {
        id: partial.id,
        title: partial.title ?? partial.id,
        body: partial.body ?? '',
        status: partial.status ?? 'backlog',
        priority: partial.priority ?? 'normal',
        matrixBucket: partial.matrixBucket ?? 'later',
        boardLane: partial.boardLane ?? 'backlog',
        dueAt: partial.dueAt ?? null,
        remindAt: partial.remindAt ?? null,
        notePaths: partial.notePaths ?? [],
        instanceLinks: partial.instanceLinks ?? [],
        createdBy: partial.createdBy ?? 'agent',
        updatedBy: partial.updatedBy ?? 'agent',
        revision: partial.revision ?? 1,
        createdAt: partial.createdAt ?? '2026-05-11T00:00:00.000Z',
        updatedAt: partial.updatedAt ?? '2026-05-11T00:00:00.000Z',
    };
}

test('workspace frontend API and server route use the canonical dashboard workspace path', () => {
    const server = read('src/manager/server.ts');
    const api = read('public/manager/src/workspace/workspace-api.ts');
    const projections = read('public/manager/src/workspace/workspace-projections.ts');

    assert.ok(server.includes("app.use('/api/dashboard/workspace', createDashboardWorkspaceRouter())"), 'server must mount workspace routes');
    assert.ok(api.includes("const BASE = '/api/dashboard/workspace'"), 'frontend workspace API must target the workspace route');
    assert.ok(api.includes('Workspace API is not available'), 'workspace API must fail visibly against stale running backends');
    assert.ok(projections.includes('itemsToBoardLanes'), 'workspace projections must expose board projection');
    assert.ok(projections.includes('itemsForNote'), 'workspace projections must expose note projection');
    assert.ok(projections.includes('itemsForInstance'), 'workspace projections must expose instance projection');
});

test('workspace projections split board lanes, matrix buckets, notes, and instances', () => {
    const items = [
        item({ id: 'ready', boardLane: 'ready', priority: 'normal', notePaths: ['notes/a.md'] }),
        item({ id: 'blocked', status: 'blocked', boardLane: 'unknown', priority: 'high', matrixBucket: 'waiting' }),
        item({ id: 'done', status: 'done', boardLane: 'done', priority: 'high', matrixBucket: 'urgentImportant' }),
        item({
            id: 'instance',
            boardLane: 'active',
            priority: 'low',
            matrixBucket: 'important',
            instanceLinks: [{ instanceId: 'i1', port: 24576, messageId: 'm1', turnIndex: 2, threadKey: 't1' }],
        }),
    ];

    assert.deepEqual(itemsToBoardLanes(items).ready.map(entry => entry.id), ['ready']);
    assert.deepEqual(itemsToBoardLanes(items).active.map(entry => entry.id), ['blocked', 'instance']);
    assert.deepEqual(itemsToBoardLanes(items).done.map(entry => entry.id), ['done']);
    assert.deepEqual(itemsToMatrixBuckets(items).urgentImportant.map(entry => entry.id), []);
    assert.deepEqual(itemsToMatrixBuckets(items).waiting.map(entry => entry.id), ['blocked']);
    assert.deepEqual(itemsForNote('notes/a.md', items).map(entry => entry.id), ['ready']);
    assert.deepEqual(itemsForInstance({ instanceId: null, port: 24576, messageId: null, turnIndex: null, threadKey: null }, items).map(entry => entry.id), ['instance']);
});

test('workspace top priority uses priority, due/remind time, and skips done items', () => {
    const items = [
        item({ id: 'done', status: 'done', priority: 'high', dueAt: '2026-05-11T01:00:00.000Z' }),
        item({ id: 'normal-soon', priority: 'normal', dueAt: '2026-05-11T02:00:00.000Z' }),
        item({ id: 'high-later', priority: 'high', dueAt: '2026-05-11T04:00:00.000Z' }),
        item({ id: 'high-soon', priority: 'high', remindAt: '2026-05-11T03:00:00.000Z' }),
    ];

    assert.deepEqual(itemsToTopPriority(items, 3).map(entry => entry.id), ['high-soon', 'high-later', 'normal-soon']);
});

test('workspace item normalization keeps nullable arrays stable for UI consumers', () => {
    const normalized = normalizeWorkspaceItem({
        ...item({ id: 'normalize' }),
        body: null as never,
        dueAt: undefined as never,
        remindAt: undefined as never,
        notePaths: null as never,
        instanceLinks: null as never,
    });

    assert.equal(normalized.body, '');
    assert.equal(normalized.dueAt, null);
    assert.equal(normalized.remindAt, null);
    assert.deepEqual(normalized.notePaths, []);
    assert.deepEqual(normalized.instanceLinks, []);
});

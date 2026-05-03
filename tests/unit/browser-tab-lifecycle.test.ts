import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTabDuration, selectTabsForCleanup } from '../../src/browser/tab-lifecycle.ts';

test('browser tab lifecycle parses cleanup duration strings', () => {
    assert.equal(parseTabDuration('500ms'), 500);
    assert.equal(parseTabDuration('2s'), 2000);
    assert.equal(parseTabDuration('3m'), 180000);
    assert.equal(parseTabDuration('1h'), 3600000);
    assert.equal(parseTabDuration('bad'), 1800000);
});

test('browser tab lifecycle selects idle tabs but preserves pinned and active-session tabs', () => {
    const now = 1_000_000;
    const selected = selectTabsForCleanup({
        now,
        idleTimeoutMs: 10_000,
        maxTabs: 10,
        tabs: [
            { tabId: 'idle', targetId: 'idle', index: 1, title: '', url: '', type: 'page', active: false, attached: true, lastActiveAt: now - 20_000 },
            { tabId: 'active-session', targetId: 'active-session', index: 2, title: '', url: '', type: 'page', active: false, attached: true, lastActiveAt: now - 20_000 },
            { tabId: 'pinned', targetId: 'pinned', index: 3, title: '', url: '', type: 'page', active: false, attached: true, lastActiveAt: now - 20_000 },
            { tabId: 'fresh', targetId: 'fresh', index: 4, title: '', url: '', type: 'page', active: false, attached: true, lastActiveAt: now - 1000 },
        ],
        activeSessionTargetIds: new Set(['active-session']),
        pinnedTargetIds: new Set(['pinned']),
    });

    assert.deepEqual(selected.map(tab => tab.targetId), ['idle']);
    assert.equal(selected[0]?.cleanupReason, 'idle-timeout');
});

test('browser tab lifecycle enforces max-tabs with oldest closeable tabs', () => {
    const selected = selectTabsForCleanup({
        now: 10_000,
        idleTimeoutMs: 60_000,
        maxTabs: 3,
        tabs: [
            { tabId: 'oldest', targetId: 'oldest', index: 1, title: '', url: '', type: 'page', active: false, attached: true, lastActiveAt: 100 },
            { tabId: 'active-session', targetId: 'active-session', index: 2, title: '', url: '', type: 'page', active: false, attached: true, lastActiveAt: 200 },
            { tabId: 'middle', targetId: 'middle', index: 3, title: '', url: '', type: 'page', active: false, attached: true, lastActiveAt: 300 },
            { tabId: 'newest', targetId: 'newest', index: 4, title: '', url: '', type: 'page', active: false, attached: true, lastActiveAt: 400 },
            { tabId: 'pinned', targetId: 'pinned', index: 5, title: '', url: '', type: 'page', active: false, attached: true, lastActiveAt: 50 },
        ],
        activeSessionTargetIds: new Set(['active-session']),
        pinnedTargetIds: new Set(['pinned']),
    });

    assert.deepEqual(selected.map(tab => tab.targetId), ['oldest', 'middle']);
    assert.equal(selected.every(tab => tab.cleanupReason === 'max-tabs'), true);
});

test('browser tab lifecycle closes untracked tabs only when explicit', () => {
    const input = {
        now: 10_000,
        idleTimeoutMs: 1000,
        maxTabs: 10,
        tabs: [
            { tabId: 'untracked', targetId: 'untracked', index: 1, title: '', url: '', type: 'page', active: false, attached: true, lastActiveAt: null },
        ],
    };

    assert.deepEqual(selectTabsForCleanup(input), []);
    assert.deepEqual(selectTabsForCleanup({ ...input, includeUntracked: true }).map(tab => tab.cleanupReason), ['untracked']);
});

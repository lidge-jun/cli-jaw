import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withManagerBrowserLock } from './manager-browser-test-lock';
import { MANAGER_URL, pageForManager } from './manager-notes-page';

test('notes sidebar does not refetch tree/index on every render while active', async () => await withManagerBrowserLock(async () => {
    const page = await pageForManager();

    await page.goto(MANAGER_URL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
        await fetch('/api/dashboard/registry', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                ui: {
                    sidebarMode: 'notes',
                    notesSelectedPath: null,
                    notesViewMode: 'preview',
                    notesAuthoringMode: 'plain',
                },
            }),
        });
    });

    const counts = { tree: 0, index: 0 };
    page.on('request', request => {
        const url = request.url();
        if (url.includes('/api/dashboard/notes/tree')) counts.tree += 1;
        if (url.includes('/api/dashboard/notes/index')) counts.index += 1;
    });

    await page.goto(MANAGER_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.notes-tree', { timeout: 5000 });
    await page.waitForTimeout(2000);

    assert.ok(counts.tree <= 2, `notes tree refetched too often: ${counts.tree}`);
    assert.ok(counts.index <= 2, `notes index refetched too often: ${counts.index}`);
}));

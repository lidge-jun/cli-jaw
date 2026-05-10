import type { Page } from 'playwright-core';

const MANAGER_URL = process.env.MANAGER_DASHBOARD_URL || 'http://127.0.0.1:24576/';

export type DashboardNoteCleanupEntry = {
    path: string;
    kind: 'file' | 'folder';
};

type TreeEntry = {
    path: string;
    children?: TreeEntry[];
};

export async function cleanupDashboardNotes(
    page: Page,
    entries: DashboardNoteCleanupEntry[],
): Promise<void> {
    for (const entry of [...entries].reverse()) {
        await cleanupDashboardNote(page, entry);
    }
}

async function cleanupDashboardNote(page: Page, entry: DashboardNoteCleanupEntry): Promise<void> {
    if (!await targetExists(page, entry)) return;

    const trash = await page.request.post(managerApiUrl(page, '/api/dashboard/notes/trash'), {
        data: entry,
        headers: { 'content-type': 'application/json' },
    });
    if (trash.ok()) return;
    if (!await targetExists(page, entry)) return;

    const body = await trash.text().catch(() => '');
    throw new Error(`note cleanup trash failed for ${entry.path}: ${trash.status()} ${body.slice(0, 200)}`);
}

async function targetExists(page: Page, entry: DashboardNoteCleanupEntry): Promise<boolean> {
    return entry.kind === 'folder'
        ? await folderExists(page, entry.path)
        : await fileExists(page, entry.path);
}

async function fileExists(page: Page, notePath: string): Promise<boolean> {
    const response = await page.request.get(
        managerApiUrl(page, `/api/dashboard/notes/file?path=${encodeURIComponent(notePath)}`),
    );
    if (response.status() === 404) return false;
    if (!response.ok()) {
        throw new Error(`note cleanup file lookup failed for ${notePath}: ${response.status()}`);
    }
    return true;
}

async function folderExists(page: Page, folderPath: string): Promise<boolean> {
    const response = await page.request.get(managerApiUrl(page, '/api/dashboard/notes/tree'));
    if (!response.ok()) {
        throw new Error(`note cleanup tree lookup failed for ${folderPath}: ${response.status()}`);
    }
    return treeIncludes(await response.json() as TreeEntry[], folderPath);
}

function treeIncludes(entries: TreeEntry[], targetPath: string): boolean {
    for (const item of entries) {
        if (item.path === targetPath) return true;
        if (item.children && treeIncludes(item.children, targetPath)) return true;
    }
    return false;
}

function managerApiUrl(page: Page, path: string): string {
    const currentUrl = page.url();
    const base = currentUrl.startsWith('http') ? currentUrl : MANAGER_URL;
    return new URL(path, base).toString();
}

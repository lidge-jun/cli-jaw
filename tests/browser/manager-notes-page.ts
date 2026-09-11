/**
 * One headless page for the Manager notes smokes.
 *
 * Four files launched Chromium, pushed the browser onto a local `browsers`
 * array and registered the same `after()` closer — three of them under an
 * identical `pageForManager`, the fourth inline. Owning the array here means
 * the cleanup cannot be forgotten by the next file that needs a page.
 *
 * This is NOT the same helper as `pageForManager` in manager-layout-smoke:
 * that one connects to an already-running browser over CDP, takes a
 * `TestContext` and skips when no browser is there. Same name, different
 * contract, deliberately not merged.
 */
import { after } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';

export const MANAGER_URL = process.env.MANAGER_DASHBOARD_URL || 'http://127.0.0.1:24576/';

const browsers: Browser[] = [];

/** A fresh headless browser, context and page. The browser is closed for you. */
export async function pageForManager(): Promise<Page> {
    const browser = await chromium.launch({ headless: true });
    browsers.push(browser);
    const context = await browser.newContext();
    return await context.newPage();
}

/** The notes file API's status code, read from inside the page's own origin. */
export async function pageApiStatus(page: Page, path: string): Promise<number> {
    return await page.evaluate(async (notePath) => {
        const response = await fetch(`/api/dashboard/notes/file?path=${encodeURIComponent(notePath)}`);
        return response.status;
    }, path);
}

// Importing this module adopts its cleanup: every browser it launched closes
// when the importing file's tests finish.
after(async () => {
    await Promise.allSettled(browsers.map(browser => browser.close()));
});

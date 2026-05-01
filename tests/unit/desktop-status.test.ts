import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import {
    CLI_JAW_DESKTOP_DOWNLOAD_URL,
    createDesktopStatusRouter,
} from '../../src/manager/routes/desktop-status.js';

async function withDesktopStatusServer(
    fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
    const app = express();
    const server = http.createServer(app);
    app.use('/api/dashboard/desktop-status', createDesktopStatusRouter());

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
    }
}

test('desktop status reports plain browser requests as not in desktop', async () => {
    await withDesktopStatusServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/dashboard/desktop-status`);
        assert.equal(response.status, 200);
        const body = await response.json() as Record<string, unknown>;

        assert.equal(body.inDesktop, false);
        assert.equal(typeof body.version, 'string');
        assert.equal(body.downloadUrl, CLI_JAW_DESKTOP_DOWNLOAD_URL);
    });
});

test('desktop status detects Electron preload identity header', async () => {
    await withDesktopStatusServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/dashboard/desktop-status`, {
            headers: { 'X-CLI-Jaw-Electron': '1' },
        });
        assert.equal(response.status, 200);
        const body = await response.json() as Record<string, unknown>;

        assert.equal(body.inDesktop, true);
        assert.equal(typeof body.version, 'string');
        assert.equal(body.downloadUrl, CLI_JAW_DESKTOP_DOWNLOAD_URL);
    });
});

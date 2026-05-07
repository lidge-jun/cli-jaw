import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserOpenCommand } from '../../src/manager/browser-open.js';
import {
    isHeadlessDashboardEnvironment,
    shouldOpenDashboardByDefault,
} from '../../src/manager/dashboard-open-default.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

test('dashboard browser opener uses Windows shell from WSL', () => {
    const command = browserOpenCommand('http://localhost:24576', 'linux', {
        WSL_DISTRO_NAME: 'Ubuntu',
    });

    assert.deepEqual(command, {
        command: 'cmd.exe',
        args: ['/c', 'start', '', 'http://localhost:24576'],
    });
});

test('dashboard browser opener keeps Linux xdg-open for desktop Linux', () => {
    const command = browserOpenCommand('http://localhost:24576', 'linux', {
        DISPLAY: ':0',
    });

    assert.deepEqual(command, {
        command: 'xdg-open',
        args: ['http://localhost:24576'],
    });
});

test('dashboard does not auto-open by default in headless and WSL environments', () => {
    assert.equal(shouldOpenDashboardByDefault({ WSL_INTEROP: '/run/WSL/1_interop' }, 'linux'), false);
    assert.equal(shouldOpenDashboardByDefault({}, 'linux'), false);
    assert.equal(shouldOpenDashboardByDefault({ CI: 'true' }, 'darwin'), false);
    assert.equal(shouldOpenDashboardByDefault({ DISPLAY: ':0' }, 'linux'), true);
    assert.equal(isHeadlessDashboardEnvironment({ SSH_CONNECTION: 'host 22 host 12345' }, 'linux'), true);
});

test('dashboard opener failure is logged without crashing the manager', () => {
    const browserOpen = read('src/manager/browser-open.ts');

    assert.ok(browserOpen.includes("opener.on('error'"), 'opener spawn errors must be handled');
    assert.ok(browserOpen.includes('failed to open browser automatically'), 'failure must be visible to the user');
    assert.ok(browserOpen.includes('open manually'), 'manual URL fallback must be printed');
});

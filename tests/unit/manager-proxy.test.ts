import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildProxyUpgradeRequest,
    dashboardProxyRange,
    isDashboardProxyPortAllowed,
    parseDashboardProxyUrl,
} from '../../src/manager/proxy.js';
import type { IncomingMessage } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

test('dashboard proxy allows only configured scan range', () => {
    const range = dashboardProxyRange({ from: 3457, count: 50 });

    assert.equal(isDashboardProxyPortAllowed(3457, range), true);
    assert.equal(isDashboardProxyPortAllowed(3506, range), true);
    assert.equal(isDashboardProxyPortAllowed(3456, range), false);
    assert.equal(isDashboardProxyPortAllowed(3507, range), false);
});

test('dashboard proxy parses safe target path', () => {
    const range = dashboardProxyRange({ from: 3457, count: 50 });
    const parsed = parseDashboardProxyUrl('/i/3457/api/health?x=1', range);

    assert.deepEqual(parsed, {
        ok: true,
        port: 3457,
        targetPath: '/api/health?x=1',
    });
});

test('dashboard proxy rejects ports outside allowlist', () => {
    const range = dashboardProxyRange({ from: 3457, count: 50 });

    assert.equal(parseDashboardProxyUrl('/i/1/', range).ok, false);
    assert.equal(parseDashboardProxyUrl('/i/65535/', range).ok, false);
    assert.equal(parseDashboardProxyUrl('/i/3507/', range).ok, false);
});

test('dashboard proxy rejects traversal paths', () => {
    const range = dashboardProxyRange({ from: 3457, count: 50 });

    assert.equal(parseDashboardProxyUrl('/i/3457/../../x', range).ok, false);
    assert.equal(parseDashboardProxyUrl('/i/3457/%2e%2e/x', range).ok, false);
    assert.equal(parseDashboardProxyUrl('/i/3457/%2E%2E/x', range).ok, false);
    assert.equal(parseDashboardProxyUrl('/i/3457/%5c..%5cx', range).ok, false);
});

test('dashboard proxy builds websocket upgrade request for target instance', () => {
    const req = {
        method: 'GET',
        httpVersion: '1.1',
        headers: {
            host: 'localhost:24576',
            connection: 'Upgrade',
            upgrade: 'websocket',
        },
    } as IncomingMessage;

    const request = buildProxyUpgradeRequest(req, '/ws?client=manager', 3457);

    assert.match(request, /^GET \/ws\?client=manager HTTP\/1\.1\r\n/);
    assert.match(request, /Host: 127\.0\.0\.1:3457\r\n/);
    assert.match(request, /connection: Upgrade\r\n/);
    assert.match(request, /upgrade: websocket\r\n/);
});

test('dashboard proxy exposes websocket upgrade routing contract', () => {
    const proxy = read('src/manager/proxy.ts');

    assert.ok(proxy.includes("server.on('upgrade'"));
    assert.ok(proxy.includes('proxyWebSocketUpgrade'));
    assert.ok(proxy.includes('parseDashboardProxyUrl'));
    assert.ok(proxy.includes('buildProxyUpgradeRequest'));
});

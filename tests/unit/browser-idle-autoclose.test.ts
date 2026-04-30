import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    DEFAULT_IDLE_TIMEOUT_MS,
    browserIdleTimeoutMs,
    browserReaperIntervalMs,
    decideBrowserCloseAction,
    parseBrowserRuntimeTimeout,
    shouldCloseIdleRuntime,
    type BrowserRuntimeOwner,
} from '../../src/browser/runtime-owner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..', '..');
const connectionSrc = fs.readFileSync(join(root, 'src', 'browser', 'connection.ts'), 'utf8');
const routesSrc = fs.readFileSync(join(root, 'src', 'routes', 'browser.ts'), 'utf8');

function owner(overrides: Partial<BrowserRuntimeOwner> = {}): BrowserRuntimeOwner {
    return {
        ownership: 'jaw-owned',
        pid: 1234,
        port: 9245,
        userDataDir: '/tmp/jaw/browser-profile',
        startedAt: '2026-04-30T00:00:00.000Z',
        lastUsedAt: '2026-04-30T00:00:00.000Z',
        headless: true,
        idleTimeoutMs: 10 * 60 * 1000,
        autoCloseEnabled: true,
        verified: true,
        ...overrides,
    };
}

test('idle timeout parser accepts finite millisecond values and rejects unsafe values', () => {
    assert.equal(parseBrowserRuntimeTimeout('2000', DEFAULT_IDLE_TIMEOUT_MS), 2000);
    assert.equal(parseBrowserRuntimeTimeout('99', DEFAULT_IDLE_TIMEOUT_MS), DEFAULT_IDLE_TIMEOUT_MS);
    assert.equal(parseBrowserRuntimeTimeout('nope', DEFAULT_IDLE_TIMEOUT_MS), DEFAULT_IDLE_TIMEOUT_MS);
});

test('runtime timeout helpers read env without adding CLI flags', () => {
    const prevIdle = process.env.JAW_BROWSER_IDLE_TIMEOUT_MS;
    const prevReaper = process.env.JAW_BROWSER_REAPER_INTERVAL_MS;
    process.env.JAW_BROWSER_IDLE_TIMEOUT_MS = '3000';
    process.env.JAW_BROWSER_REAPER_INTERVAL_MS = '500';
    try {
        assert.equal(browserIdleTimeoutMs(), 3000);
        assert.equal(browserReaperIntervalMs(), 500);
    } finally {
        if (prevIdle === undefined) delete process.env.JAW_BROWSER_IDLE_TIMEOUT_MS;
        else process.env.JAW_BROWSER_IDLE_TIMEOUT_MS = prevIdle;
        if (prevReaper === undefined) delete process.env.JAW_BROWSER_REAPER_INTERVAL_MS;
        else process.env.JAW_BROWSER_REAPER_INTERVAL_MS = prevReaper;
    }
});

test('jaw-owned idle runtime closes only after timeout and with no active command', () => {
    const runtime = owner();
    assert.equal(shouldCloseIdleRuntime(runtime, Date.parse('2026-04-30T00:09:59.000Z'), 0), false);
    assert.equal(shouldCloseIdleRuntime(runtime, Date.parse('2026-04-30T00:10:00.000Z'), 1), false);
    assert.equal(shouldCloseIdleRuntime(runtime, Date.parse('2026-04-30T00:10:00.000Z'), 0), true);
});

test('external and proof-failed runtimes never terminate Chrome', () => {
    assert.equal(decideBrowserCloseAction(owner({ ownership: 'external' }), 'idle', true), 'skip');
    assert.equal(decideBrowserCloseAction(owner({ ownership: 'external' }), 'manual', true), 'disconnect-only');
    assert.equal(decideBrowserCloseAction(owner(), 'idle', false), 'skip');
    assert.equal(decideBrowserCloseAction(owner(), 'manual', false), 'skip');
    assert.equal(decideBrowserCloseAction(owner(), 'idle', true), 'close-owned');
});

test('connection keeps activePort and exposes runtime status/reset exports', () => {
    assert.match(connectionSrc, /let\s+activePort:\s*number\s*\|\s*null\s*=\s*null/);
    assert.match(connectionSrc, /function\s+ensureIdleReaperStarted/);
    assert.match(connectionSrc, /\.unref\?\.\(\)/);
    assert.match(connectionSrc, /export\s+function\s+getBrowserRuntimeStatus/);
    assert.match(connectionSrc, /export\s+function\s+resetBrowserRuntimeForTests/);
});

test('status route is excluded from activity tracking while web-ai status is included', () => {
    assert.match(routesSrc, /BROWSER_ACTIVITY_PATHS[\s\S]*\/api\/browser\/web-ai\/status/);
    assert.doesNotMatch(
        routesSrc.match(/const BROWSER_ACTIVITY_PATHS = \[[\s\S]*?\];/)?.[0] || '',
        /\/api\/browser\/status['"]/,
    );
});

test('external browser stop path does not call browser.close or send process signals', () => {
    const externalBranch = connectionSrc.match(/if\s*\(runtimeOwner\?\.ownership === 'external'\)[\s\S]*?return;\n\s*\}/)?.[0] || '';
    assert.match(externalBranch, /disconnectLocalBrowserCache\(\)/);
    assert.doesNotMatch(externalBranch, /\.close\(/);
    assert.doesNotMatch(externalBranch, /kill\(/);
});

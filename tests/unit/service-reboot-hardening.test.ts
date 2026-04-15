import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServicePath } from '../../src/core/runtime-path.ts';

const ROOT = process.cwd();
const SERVER = path.join(ROOT, 'server.ts');
const CONFIG = path.join(ROOT, 'src/core/config.ts');
const SPAWN = path.join(ROOT, 'src/agent/spawn.ts');
const LIFECYCLE = path.join(ROOT, 'src/agent/lifecycle-handler.ts');
const DB = path.join(ROOT, 'src/core/db.ts');
const LAUNCHD = path.join(ROOT, 'bin/commands/launchd.ts');
const SERVICE = path.join(ROOT, 'bin/commands/service.ts');

test('SRH-001: buildServicePath augments minimal PATH with common service-safe directories', () => {
    const built = buildServicePath('/usr/bin:/bin', []);
    assert.match(built, /\/usr\/local\/bin/);
    assert.match(built, /\/opt\/homebrew\/bin/);
    assert.match(built, /\/usr\/bin/);
});

test('SRH-002: buildServicePath discovers managed node bins from a custom home', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-path-'));
    const nvmBin = path.join(tmpHome, '.nvm', 'versions', 'node', 'v22.9.0', 'bin');
    fs.mkdirSync(nvmBin, { recursive: true });

    const built = buildServicePath('/usr/bin:/bin', [], tmpHome);
    assert.ok(
        built.split(path.delimiter).includes(nvmBin),
        'nvm-managed node bin should be included in service PATH',
    );
});

test('SRH-003: server clears stale employee sessions before heartbeat and seeds employees first', () => {
    const src = fs.readFileSync(SERVER, 'utf8');
    const clearIdx = src.indexOf('clearAllEmployeeSessions.run()');
    const seedIdx = src.indexOf('const seeded = seedDefaultEmployees()');
    const heartbeatIdx = src.indexOf('startHeartbeat();');

    assert.ok(clearIdx >= 0, 'startup must clear employee_sessions');
    assert.ok(seedIdx >= 0, 'startup must seed default employees');
    assert.ok(heartbeatIdx >= 0, 'startup must start heartbeat');
    assert.ok(seedIdx < heartbeatIdx, 'heartbeat must start after employees are seeded');
});

test('SRH-004: service installers use shared service PATH builder instead of raw process.env.PATH', () => {
    const launchdSrc = fs.readFileSync(LAUNCHD, 'utf8');
    const serviceSrc = fs.readFileSync(SERVICE, 'utf8');

    assert.match(launchdSrc, /buildServicePath\(process\.env\.PATH \|\| ''/);
    assert.match(serviceSrc, /buildServicePath\(process\.env\.PATH \|\| ''/);
    assert.doesNotMatch(launchdSrc, /<string>\$\{xmlEsc\(process\.env\.PATH \|\| ''\)\}<\/string>/);
    assert.doesNotMatch(serviceSrc, /Environment="PATH=\$\{process\.env\.PATH \|\| '\/usr\/local\/bin:\/usr\/bin:\/bin'\}"/);
});

test('SRH-005: spawn path and detectCli logic use service-safe PATH handling', () => {
    const spawnSrc = fs.readFileSync(SPAWN, 'utf8');
    const configSrc = fs.readFileSync(CONFIG, 'utf8');
    const lifecycleSrc = fs.readFileSync(LIFECYCLE, 'utf8');
    const dbSrc = fs.readFileSync(DB, 'utf8');

    assert.match(spawnSrc, /env\.PATH = buildServicePath\(env\.PATH \|\| ''\)/);
    assert.match(spawnSrc, /const spawnCommand = process\.platform === 'win32' \? cli : \(detected\.path \|\| cli\)/);
    assert.match(spawnSrc, /clearEmployeeSession\.run\(opts\.agentId\)/);
    assert.match(lifecycleSrc, /clearEmployeeSession\.run\(opts\.agentId\)/);
    assert.match(dbSrc, /export const clearEmployeeSession = db\.prepare\('DELETE FROM employee_sessions WHERE employee_id = \?'\)/);
    assert.match(configSrc, /PATH: buildServicePath\(process\.env\.PATH \|\| ''\)/);
});

test('SRH-006: loadSettings warns and backs up unreadable settings instead of silently overwriting them', () => {
    const src = fs.readFileSync(CONFIG, 'utf8');
    assert.match(src, /if \(err\?\.code === 'ENOENT'\)/);
    assert.match(src, /console\.warn\(`\[jaw:settings\] failed to load/);
    assert.match(src, /copyFileSync\(SETTINGS_PATH, backupPath\)/);
    assert.ok(
        src.indexOf("if (err?.code === 'ENOENT')") < src.indexOf('copyFileSync(SETTINGS_PATH, backupPath)'),
        'backup path must only run after the ENOENT fast-path',
    );
});

// ─── New tests for findings #6-#10 ─────────────────

const DISPATCH = path.join(ROOT, 'bin/commands/dispatch.ts');
const SHARED = path.join(ROOT, 'src/memory/shared.ts');

test('SRH-007: messaging init is awaited before heartbeat starts', () => {
    const src = fs.readFileSync(SERVER, 'utf8');
    assert.match(src, /await initActiveMessagingRuntime\(\)/,
        'messaging init must be awaited, not fire-and-forget');
    const awaitIdx = src.indexOf('await initActiveMessagingRuntime()');
    const heartbeatIdx = src.indexOf('startHeartbeat();');
    assert.ok(awaitIdx < heartbeatIdx,
        'messaging must be initialized before heartbeat starts');
});

test('SRH-008: dispatch CLI has retry logic for ECONNREFUSED', () => {
    const src = fs.readFileSync(DISPATCH, 'utf8');
    assert.match(src, /STARTUP_RETRY_DELAYS_MS/,
        'dispatch must define retry delays for cold-start scenario');
    assert.match(src, /isConnRefused/,
        'dispatch must detect ECONNREFUSED errors');
    assert.match(src, /Server starting up, retrying/,
        'dispatch must inform user about retry during startup');
});

test('SRH-009: message queue is persisted to DB', () => {
    const spawnSrc = fs.readFileSync(SPAWN, 'utf8');
    const dbSrc = fs.readFileSync(DB, 'utf8');

    assert.match(dbSrc, /queued_messages/,
        'queued_messages table must exist in schema');
    assert.match(dbSrc, /insertQueuedMessage/,
        'insertQueuedMessage statement must be exported');
    assert.match(dbSrc, /deleteQueuedMessage/,
        'deleteQueuedMessage statement must be exported');
    assert.match(spawnSrc, /insertQueuedMessage\.run\(item\.id/,
        'enqueueMessage must persist to DB');
    assert.match(spawnSrc, /deleteQueuedMessage\.run\(item\.id\)/,
        'processQueue must remove processed items from DB');
    assert.match(spawnSrc, /loadPersistedQueue/,
        'queue must be loaded from DB on module init');
});

test('SRH-010: orphaned employee tmp dirs are cleaned on startup', () => {
    const src = fs.readFileSync(SERVER, 'utf8');
    assert.match(src, /jaw-emp-/,
        'startup must reference jaw-emp- prefix for cleanup');
    assert.match(src, /orphaned employee tmp dir/,
        'startup must log cleanup of orphaned dirs');
});

test('SRH-011: migration lock has PID staleness check', () => {
    const src = fs.readFileSync(SHARED, 'utf8');
    assert.match(src, /isProcessAlive/,
        'migration lock must check if holding process is alive');
    assert.match(src, /process\.kill\(.*0\)/,
        'must use signal 0 to check PID existence');
    assert.match(src, /stale lock/,
        'must log when removing stale lock');
});

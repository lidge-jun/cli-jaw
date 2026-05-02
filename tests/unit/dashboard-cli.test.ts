import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

test('dashboard CLI supports all lifecycle subcommands', () => {
    const dashboard = read('bin/commands/dashboard.ts');
    for (const cmd of ['start', 'stop', 'restart', 'perm', 'unperm']) {
        assert.ok(dashboard.includes(`case '${cmd}'`), `must handle '${cmd}' subcommand`);
    }
});

test('dashboard CLI supports status and list subcommands', () => {
    const dashboard = read('bin/commands/dashboard.ts');
    assert.ok(dashboard.includes("case 'status'"), 'must handle status');
    assert.ok(dashboard.includes("case 'ls'"), 'must handle ls');
    assert.ok(dashboard.includes("case 'list'"), 'must handle list alias');
});

test('dashboard CLI uses correct API endpoints', () => {
    const dashboard = read('bin/commands/dashboard.ts');
    assert.ok(dashboard.includes('/api/dashboard/health'), 'status must hit health endpoint');
    assert.ok(dashboard.includes('/api/dashboard/instances'), 'ls must hit instances endpoint');
    assert.ok(dashboard.includes('/api/dashboard/lifecycle/'), 'lifecycle must hit lifecycle endpoint');
});

test('dashboard CLI parses --json globally before subcommand switch', () => {
    const dashboard = read('bin/commands/dashboard.ts');
    const jsonIndex = dashboard.indexOf("json: { type: 'boolean'");
    const switchIndex = dashboard.indexOf('switch (subcommand)');
    assert.ok(jsonIndex >= 0, '--json option must be declared');
    assert.ok(switchIndex >= 0, 'subcommand switch must exist');
    assert.ok(jsonIndex < switchIndex, '--json must be parsed before switch');
});

test('dashboard service delegates to dashboard-service module', () => {
    const dashboard = read('bin/commands/dashboard.ts');
    assert.ok(dashboard.includes('dashboard-service'), 'must import dashboard-service');
    assert.ok(dashboard.includes('permDashboard'), 'must call permDashboard');
    assert.ok(dashboard.includes('unpermDashboard'), 'must call unpermDashboard');
    assert.ok(dashboard.includes('dashboardServiceStatus'), 'must call dashboardServiceStatus');
});

test('dashboard-service.ts supports both launchd and systemd', () => {
    const svc = read('src/manager/dashboard-service.ts');
    assert.ok(svc.includes('com.cli-jaw.dashboard'), 'launchd label must be com.cli-jaw.dashboard');
    assert.ok(svc.includes('jaw-dashboard'), 'systemd unit must be jaw-dashboard');
    assert.ok(svc.includes('detectBackend'), 'must use detectBackend from platform-service');
});

test('dashboard CLI printUsage lists all subcommands', () => {
    const dashboard = read('bin/commands/dashboard.ts');
    for (const cmd of ['serve', 'status', 'ls', 'start', 'stop', 'restart', 'perm', 'unperm', 'service']) {
        assert.ok(dashboard.includes(cmd), `help text must mention '${cmd}'`);
    }
    assert.ok(dashboard.includes('--json'), 'help text must mention --json');
});

test('dashboard lifecycle commands set exitCode on failure', () => {
    const dashboard = read('bin/commands/dashboard.ts');
    const lifecycleSection = dashboard.slice(dashboard.indexOf('async function handleLifecycle'));
    assert.ok(lifecycleSection.includes('process.exitCode = 1'), 'must set exitCode on failure');
});

test('dashboard-service label does not collide with instance labels', () => {
    const svc = read('src/manager/dashboard-service.ts');
    const launchd = read('src/manager/launchd-service.ts');
    assert.ok(svc.includes('com.cli-jaw.dashboard'), 'dashboard label format');
    assert.ok(!launchd.includes('com.cli-jaw.dashboard'), 'instance labels must not use dashboard label');
});

test('dashboard CLI supports --help flag', () => {
    const dashboard = read('bin/commands/dashboard.ts');
    assert.ok(dashboard.includes('shouldShowHelp'), 'must check for --help');
    assert.ok(dashboard.includes('printAndExit'), 'must call printAndExit for help');
});

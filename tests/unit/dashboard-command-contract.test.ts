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

test('cli routes dashboard command separately from serve', () => {
    const cli = read('bin/cli-jaw.ts');

    assert.ok(cli.includes("'dashboard'"), 'dashboard must be listed as a known command');
    assert.ok(cli.includes("case 'dashboard'"), 'dashboard switch case must exist');
    assert.ok(cli.includes("import('./commands/dashboard.js')"), 'dashboard must route to dashboard command');
    assert.ok(cli.includes("case 'serve'"), 'existing serve switch case must remain');
    assert.ok(cli.includes("import('./commands/serve.js')"), 'existing serve route must remain');
});

test('dashboard command declares approved defaults and placeholder service', () => {
    const dashboard = read('bin/commands/dashboard.ts');

    assert.ok(dashboard.includes('DASHBOARD_DEFAULT_PORT'), 'dashboard command must use manager default port constant');
    assert.ok(dashboard.includes('MANAGED_INSTANCE_PORT_FROM'), 'dashboard command must use scan start constant');
    assert.ok(dashboard.includes('MANAGED_INSTANCE_PORT_COUNT'), 'dashboard command must use scan count constant');
    assert.ok(dashboard.includes("subcommand === 'service'"), 'dashboard service must be handled explicitly');
    assert.ok(dashboard.includes('planned for a later phase'), 'dashboard service must be placeholder-only');
});

test('dashboard implementation does not mount into existing serve path', () => {
    const serve = read('bin/commands/serve.ts');
    const server = read('server.ts');

    assert.equal(serve.includes('dashboard'), false, 'serve.ts must not contain dashboard implementation');
    assert.equal(server.includes('/api/dashboard'), false, 'server.ts must not mount dashboard routes');
});

test('dashboard proxy is installed only in manager server', () => {
    const managerServer = read('src/manager/server.ts');
    const rootServer = read('server.ts');

    assert.ok(managerServer.includes('installDashboardProxy'), 'manager server must install dashboard proxy');
    assert.equal(rootServer.includes('installDashboardProxy'), false, 'root server.ts must not install dashboard proxy');
    assert.equal(rootServer.includes('/i/:port'), false, 'root server.ts must not mount proxy routes');
});

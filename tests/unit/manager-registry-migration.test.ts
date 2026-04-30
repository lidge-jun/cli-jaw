import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DASHBOARD_HOME_ENV } from '../../src/manager/dashboard-home.js';
import {
    dashboardRegistryPath,
    loadDashboardRegistry,
    patchDashboardRegistry,
} from '../../src/manager/registry.js';

const REGISTRY_FILE = 'manager-instances.json';

function tempDir(prefix: string): string {
    return mkdtempSync(join(tmpdir(), prefix));
}

function withHomes<T>(dashboardHome: string, jawHome: string, run: () => T): T {
    const previousDashboardHome = process.env[DASHBOARD_HOME_ENV];
    const previousJawHome = process.env.CLI_JAW_HOME;
    process.env[DASHBOARD_HOME_ENV] = dashboardHome;
    process.env.CLI_JAW_HOME = jawHome;
    try {
        return run();
    } finally {
        if (previousDashboardHome == null) {
            delete process.env[DASHBOARD_HOME_ENV];
        } else {
            process.env[DASHBOARD_HOME_ENV] = previousDashboardHome;
        }
        if (previousJawHome == null) {
            delete process.env.CLI_JAW_HOME;
        } else {
            process.env.CLI_JAW_HOME = previousJawHome;
        }
    }
}

function writeRegistry(path: string, selectedPort: number): void {
    writeFileSync(path, JSON.stringify({
        scan: { from: 3457, count: 9 },
        ui: { selectedPort, selectedTab: 'preview' },
        instances: { [selectedPort]: { label: `port-${selectedPort}`, favorite: true } },
        profiles: {},
        activeProfileFilter: [],
    }, null, 2));
}

test('dashboard registry path uses dashboard home, not CLI_JAW_HOME', () => {
    const dashboardHome = tempDir('jaw-dashboard-home-');
    const jawHome = tempDir('jaw-home-');
    try {
        withHomes(dashboardHome, jawHome, () => {
            assert.equal(dashboardRegistryPath(), join(dashboardHome, REGISTRY_FILE));
        });
    } finally {
        rmSync(dashboardHome, { recursive: true, force: true });
        rmSync(jawHome, { recursive: true, force: true });
    }
});

test('missing dashboard registry migrates current legacy registry once', () => {
    const dashboardHome = tempDir('jaw-dashboard-home-');
    const jawHome = tempDir('jaw-home-');
    const dashboardRegistry = join(dashboardHome, REGISTRY_FILE);
    const legacyRegistry = join(jawHome, REGISTRY_FILE);
    writeRegistry(legacyRegistry, 3459);

    try {
        withHomes(dashboardHome, jawHome, () => {
            rmSync(dashboardRegistry, { force: true });
            const legacyBefore = readFileSync(legacyRegistry, 'utf8');
            const loaded = loadDashboardRegistry();

            assert.equal(loaded.status.path, dashboardRegistry);
            assert.equal(loaded.status.dashboardHome, dashboardHome);
            assert.equal(loaded.status.migratedFrom, legacyRegistry);
            assert.equal(loaded.registry.ui.selectedPort, 3459);
            assert.equal(existsSync(dashboardRegistry), true);
            assert.equal(readFileSync(legacyRegistry, 'utf8'), legacyBefore);
        });
    } finally {
        rmSync(dashboardHome, { recursive: true, force: true });
        rmSync(jawHome, { recursive: true, force: true });
    }
});

test('existing dashboard registry wins over legacy registry', () => {
    const dashboardHome = tempDir('jaw-dashboard-home-');
    const jawHome = tempDir('jaw-home-');
    const dashboardRegistry = join(dashboardHome, REGISTRY_FILE);
    const legacyRegistry = join(jawHome, REGISTRY_FILE);
    writeRegistry(dashboardRegistry, 3460);
    writeRegistry(legacyRegistry, 3459);

    try {
        withHomes(dashboardHome, jawHome, () => {
            const loaded = loadDashboardRegistry();

            assert.equal(loaded.status.path, dashboardRegistry);
            assert.equal(loaded.status.migratedFrom, null);
            assert.equal(loaded.registry.ui.selectedPort, 3460);
        });
    } finally {
        rmSync(dashboardHome, { recursive: true, force: true });
        rmSync(jawHome, { recursive: true, force: true });
    }
});

test('migration only considers current CLI_JAW_HOME legacy registry', () => {
    const dashboardHome = tempDir('jaw-dashboard-home-');
    const jawHome = tempDir('jaw-home-current-');
    const otherJawHome = tempDir('jaw-home-other-');
    const legacyRegistry = join(jawHome, REGISTRY_FILE);
    writeRegistry(legacyRegistry, 3458);
    writeRegistry(join(otherJawHome, REGISTRY_FILE), 3462);

    try {
        withHomes(dashboardHome, jawHome, () => {
            const loaded = loadDashboardRegistry();

            assert.equal(loaded.status.migratedFrom, legacyRegistry);
            assert.equal(loaded.registry.ui.selectedPort, 3458);
            assert.equal(loaded.registry.instances['3462'], undefined);
        });
    } finally {
        rmSync(dashboardHome, { recursive: true, force: true });
        rmSync(jawHome, { recursive: true, force: true });
        rmSync(otherJawHome, { recursive: true, force: true });
    }
});

test('corrupt legacy registry is not copied to dashboard home', () => {
    const dashboardHome = tempDir('jaw-dashboard-home-');
    const jawHome = tempDir('jaw-home-');
    const dashboardRegistry = join(dashboardHome, REGISTRY_FILE);
    const legacyRegistry = join(jawHome, REGISTRY_FILE);
    writeFileSync(legacyRegistry, '{bad-json');

    try {
        withHomes(dashboardHome, jawHome, () => {
            const loaded = loadDashboardRegistry();

            assert.equal(loaded.status.path, dashboardRegistry);
            assert.equal(loaded.status.loaded, false);
            assert.equal(loaded.status.migratedFrom, null);
            assert.match(String(loaded.status.error), /JSON/);
            assert.equal(existsSync(dashboardRegistry), false);
            assert.deepEqual(loaded.registry.instances, {});
        });
    } finally {
        rmSync(dashboardHome, { recursive: true, force: true });
        rmSync(jawHome, { recursive: true, force: true });
    }
});

test('explicit registry path bypasses dashboard migration', () => {
    const dashboardHome = tempDir('jaw-dashboard-home-');
    const jawHome = tempDir('jaw-home-');
    const explicitPath = join(tempDir('jaw-explicit-registry-'), REGISTRY_FILE);
    writeRegistry(join(jawHome, REGISTRY_FILE), 3459);

    try {
        withHomes(dashboardHome, jawHome, () => {
            const loaded = loadDashboardRegistry({ path: explicitPath });

            assert.equal(loaded.status.path, explicitPath);
            assert.equal(loaded.status.dashboardHome, undefined);
            assert.equal(loaded.status.migratedFrom, null);
            assert.equal(loaded.registry.ui.selectedPort, null);
            assert.equal(existsSync(join(dashboardHome, REGISTRY_FILE)), false);
        });
    } finally {
        rmSync(dashboardHome, { recursive: true, force: true });
        rmSync(jawHome, { recursive: true, force: true });
        rmSync(join(explicitPath, '..'), { recursive: true, force: true });
    }
});

test('patch writes to dashboard home and ignores CLI_JAW_HOME', () => {
    const dashboardHome = tempDir('jaw-dashboard-home-');
    const jawHome = tempDir('jaw-home-');
    try {
        withHomes(dashboardHome, jawHome, () => {
            const saved = patchDashboardRegistry({ ui: { selectedPort: 3461 } });

            assert.equal(saved.status.path, join(dashboardHome, REGISTRY_FILE));
            assert.equal(saved.status.dashboardHome, dashboardHome);
            assert.equal(saved.registry.ui.selectedPort, 3461);
            assert.equal(existsSync(join(jawHome, REGISTRY_FILE)), false);
        });
    } finally {
        rmSync(dashboardHome, { recursive: true, force: true });
        rmSync(jawHome, { recursive: true, force: true });
    }
});

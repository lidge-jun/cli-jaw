import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import test from 'node:test';
import {
    DASHBOARD_HOME_ENV,
    DEFAULT_DASHBOARD_HOME_BASENAME,
    resolveDashboardHome,
} from '../../src/manager/dashboard-home.js';

test('dashboard home defaults to ~/.cli-jaw-dashboard', () => {
    const home = resolveDashboardHome({});

    assert.equal(home, join(homedir(), DEFAULT_DASHBOARD_HOME_BASENAME));
});

test('dashboard home honors CLI_JAW_DASHBOARD_HOME override', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'jaw-dashboard-home-'));
    try {
        assert.equal(resolveDashboardHome({ [DASHBOARD_HOME_ENV]: tmpHome }), tmpHome);
    } finally {
        rmSync(tmpHome, { recursive: true, force: true });
    }
});

test('dashboard home expands leading tilde', () => {
    const home = resolveDashboardHome({ [DASHBOARD_HOME_ENV]: '~/jaw-dashboard-test' });

    assert.equal(home, join(homedir(), 'jaw-dashboard-test'));
});

test('dashboard home resolves relative override to absolute path', () => {
    const home = resolveDashboardHome({ [DASHBOARD_HOME_ENV]: 'relative-dashboard-home' });

    assert.equal(isAbsolute(home), true);
    assert.equal(home, resolve('relative-dashboard-home'));
});

test('dashboard home is independent from CLI_JAW_HOME', () => {
    const home = resolveDashboardHome({ CLI_JAW_HOME: '/tmp/ignored-jaw-home' });

    assert.equal(home, join(homedir(), DEFAULT_DASHBOARD_HOME_BASENAME));
});

test('dashboard path resolution does not create directories', () => {
    const root = join(tmpdir(), `jaw-dashboard-missing-${Date.now()}`);
    rmSync(root, { recursive: true, force: true });

    const path = join(resolveDashboardHome({ [DASHBOARD_HOME_ENV]: root }), 'manager-instances.json');

    assert.equal(path, join(root, 'manager-instances.json'));
    assert.equal(existsSync(root), false);
});

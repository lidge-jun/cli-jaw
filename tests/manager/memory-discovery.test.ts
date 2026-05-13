import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSearchableInstancesAt } from '../../src/manager/memory/instance-discovery.ts';
import type { DashboardRegistry } from '../../src/manager/types.ts';

function freshTmp(): string {
    return mkdtempSync(join(tmpdir(), 'jaw-discovery-'));
}

function emptyRegistry(): DashboardRegistry {
    return {
        scan: { from: 3457, count: 1 },
        ui: {
            theme: 'auto',
            sidebarMode: 'instances',
            locale: 'ko',
            activityHeight: 150,
            notesTreeWidth: 280,
            notesAuthoringMode: 'auto',
            notesViewMode: 'preview',
            shortcuts: {},
            detailTab: 'overview',
        },
        instances: {},
        profiles: {},
        activeProfileFilter: [],
    };
}

test('discovery: primary port (3457) → ~/.cli-jaw (no suffix)', () => {
    const base = freshTmp();
    mkdirSync(join(base, '.cli-jaw'));
    const reg = emptyRegistry();
    reg.instances['3457'] = { label: 'primary', favorite: false, group: null, hidden: false, notes: null };
    const refs = listSearchableInstancesAt(reg, base);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.homePath, join(base, '.cli-jaw'));
    assert.equal(refs[0]!.homeSource, 'default-port');
    assert.equal(refs[0]!.hasDb, false);
});

test('discovery: non-primary port → ~/.cli-jaw-<port>', () => {
    const base = freshTmp();
    const home3458 = join(base, '.cli-jaw-3458');
    mkdirSync(join(home3458, 'memory', 'structured'), { recursive: true });
    writeFileSync(join(home3458, 'memory', 'structured', 'index.sqlite'), '');
    const reg = emptyRegistry();
    reg.instances['3458'] = { label: null, favorite: false, group: null, hidden: false, notes: null };
    const refs = listSearchableInstancesAt(reg, base);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.homePath, home3458);
    assert.equal(refs[0]!.hasDb, true);
});

test('discovery: blacklist filters .bak, smoke-, manager-, dashboard', () => {
    const base = freshTmp();
    const reg = emptyRegistry();
    reg.instances['3457'] = { label: null, favorite: false, group: null, hidden: false, notes: null };
    // smoke patterns/manager/dashboard would resolve via defaultHomeForPort and may match.
    // Simulate by injecting override map. Discovery only checks default-port names — we use
    // listSearchableInstancesAt with explicit overrides to push paths that match blacklist.
    const overrides = new Map<number, string>();
    overrides.set(3457, join(base, '.cli-jaw-smoke-x'));
    const refs = listSearchableInstancesAt(reg, base, overrides);
    assert.equal(refs.length, 0);
});

test('discovery: profile override surfaces homeSource=profile', () => {
    const base = freshTmp();
    const customHome = join(base, 'custom-elsewhere');
    mkdirSync(join(customHome, 'memory', 'structured'), { recursive: true });
    const reg = emptyRegistry();
    reg.instances['3460'] = { label: 'custom', favorite: false, group: null, hidden: false, notes: null };
    const overrides = new Map<number, string>();
    overrides.set(3460, customHome);
    const refs = listSearchableInstancesAt(reg, base, overrides);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.homeSource, 'profile');
    assert.equal(refs[0]!.homePath, customHome);
});

test('discovery: non-numeric port keys are skipped', () => {
    const base = freshTmp();
    const reg = emptyRegistry();
    (reg.instances as Record<string, unknown>)['abc'] = { label: null, favorite: false, group: null, hidden: false, notes: null };
    reg.instances['3457'] = { label: null, favorite: false, group: null, hidden: false, notes: null };
    const refs = listSearchableInstancesAt(reg, base);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.port, 3457);
});

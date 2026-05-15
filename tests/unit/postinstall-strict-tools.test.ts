import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    shouldRunLocalOfficeCliInstall,
    shouldRequireCliToolsDuringPostinstall,
    shouldRequireOfficeCliDuringPostinstall,
} from '../../bin/postinstall.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const postinstallSrc = readFileSync(join(root, 'bin/postinstall.ts'), 'utf8');

function writeExecutable(filePath: string, body: string): void {
    writeFileSync(filePath, body);
    chmodSync(filePath, 0o755);
}

function setMtime(filePath: string, date: Date): void {
    utimesSync(filePath, date, date);
}

function createLocalOfficeCliCheckout(rootDir: string, date: Date): string {
    const projectRoot = join(rootDir, 'project');
    const officeRoot = join(projectRoot, 'officecli');
    const srcRoot = join(officeRoot, 'src');
    const csprojDir = join(srcRoot, 'officecli');
    mkdirSync(csprojDir, { recursive: true });
    writeExecutable(join(officeRoot, 'dev-install.sh'), '#!/bin/sh\nexit 0\n');
    writeFileSync(join(csprojDir, 'officecli.csproj'), '<Project />\n');

    for (const target of [
        join(csprojDir, 'officecli.csproj'),
        join(officeRoot, 'dev-install.sh'),
        csprojDir,
        srcRoot,
        officeRoot,
        projectRoot,
    ]) {
        setMtime(target, date);
    }
    return projectRoot;
}

function createInstalledOfficeCli(rootDir: string, date: Date, officecliBody = '#!/bin/sh\necho 1.0.91\n'): string {
    const binDir = join(rootDir, 'bin');
    mkdirSync(binDir, { recursive: true });
    writeExecutable(join(binDir, 'officecli'), officecliBody);
    writeExecutable(join(binDir, 'rhwp-field-bridge'), '#!/bin/sh\necho rhwp-field-bridge\n');
    writeExecutable(join(binDir, 'rhwp-officecli-bridge'), '#!/bin/sh\necho rhwp-officecli-bridge\n');
    for (const target of [
        join(binDir, 'officecli'),
        join(binDir, 'rhwp-field-bridge'),
        join(binDir, 'rhwp-officecli-bridge'),
        binDir,
    ]) {
        setMtime(target, date);
    }
    return binDir;
}

function withPath<T>(pathValue: string, fn: () => T): T {
    const previousPath = process.env.PATH;
    process.env.PATH = pathValue;
    try {
        return fn();
    } finally {
        if (previousPath === undefined) {
            delete process.env.PATH;
        } else {
            process.env.PATH = previousPath;
        }
    }
}

test('postinstall exposes strict OfficeCLI mode for integrated installers', () => {
    assert.ok(postinstallSrc.includes('CLI_JAW_REQUIRE_OFFICECLI'));
    assert.ok(postinstallSrc.includes('shouldRequireOfficeCliDuringPostinstall'));
    assert.ok(postinstallSrc.includes('OfficeCLI install required but failed'));
    assert.ok(postinstallSrc.includes('OfficeCLI install required but installer script not found'));
    assert.ok(postinstallSrc.includes('OfficeCLI install required but CLI_JAW_SKIP_OFFICECLI is set'));
});

test('postinstall exposes strict bundled CLI tools mode for integrated installers', () => {
    assert.ok(postinstallSrc.includes('CLI_JAW_REQUIRE_CLI_TOOLS'));
    assert.ok(postinstallSrc.includes('shouldRequireCliToolsDuringPostinstall'));
    assert.ok(postinstallSrc.includes('Required CLI tool install failed'));
    assert.ok(postinstallSrc.includes('failed.push(`${bin} (${pkg})`)'));
});

test('postinstall keeps generic npm install best-effort without strict envs', () => {
    assert.ok(postinstallSrc.includes('shouldInstallCliToolsDuringPostinstall()'));
    assert.ok(postinstallSrc.includes('CLI tool install/update skipped by default'));
    assert.ok(postinstallSrc.includes('officecli install failed'));
    assert.ok(postinstallSrc.includes('console.warn(`[jaw:init] ⚠️  officecli install failed'));
});

test('postinstall prefers newer local OfficeCLI checkout in dev clones', () => {
    assert.ok(postinstallSrc.includes('hasLocalOfficeCliCheckout'));
    assert.ok(postinstallSrc.includes('shouldRunLocalOfficeCliInstall'));
    assert.ok(postinstallSrc.includes("path.join(PROJECT_ROOT, 'officecli', 'dev-install.sh')"));
    assert.ok(postinstallSrc.includes('local OfficeCLI checkout is newer'));
    assert.ok(postinstallSrc.includes('CLI_JAW_SKIP_LOCAL_OFFICECLI'));
    assert.ok(postinstallSrc.includes('CLI_JAW_FORCE_REMOTE_OFFICECLI'));
    assert.ok(postinstallSrc.includes('timeout: 600000'));
});

test('postinstall strict env helpers accept explicit and npm-config flags', () => {
    assert.equal(shouldRequireOfficeCliDuringPostinstall({}), false);
    assert.equal(shouldRequireOfficeCliDuringPostinstall({ CLI_JAW_REQUIRE_OFFICECLI: '1' }), true);
    assert.equal(shouldRequireOfficeCliDuringPostinstall({ npm_config_jaw_require_officecli: 'true' }), true);

    assert.equal(shouldRequireCliToolsDuringPostinstall({}), false);
    assert.equal(shouldRequireCliToolsDuringPostinstall({ CLI_JAW_REQUIRE_CLI_TOOLS: '1' }), true);
    assert.equal(shouldRequireCliToolsDuringPostinstall({ npm_config_jaw_require_cli_tools: 'true' }), true);
});

test('local OfficeCLI install decision requires runnable officecli and sidecars', (t) => {
    if (process.platform === 'win32') {
        t.skip('local officecli/dev-install.sh preference is disabled on win32');
        return;
    }

    const tmp = mkdtempSync(join(tmpdir(), 'jaw-officecli-local-'));
    try {
        const oldDate = new Date('2026-01-01T00:00:00Z');
        const newDate = new Date('2026-01-02T00:00:00Z');
        const projectRoot = createLocalOfficeCliCheckout(tmp, oldDate);
        const binDir = createInstalledOfficeCli(tmp, newDate);

        assert.equal(withPath(binDir, () => shouldRunLocalOfficeCliInstall(projectRoot)), false);

        rmSync(join(binDir, 'rhwp-field-bridge'));
        assert.equal(withPath(binDir, () => shouldRunLocalOfficeCliInstall(projectRoot)), true);

        createInstalledOfficeCli(tmp, newDate, '#!/bin/sh\nexit 42\n');
        assert.equal(withPath(binDir, () => shouldRunLocalOfficeCliInstall(projectRoot)), true);

        createLocalOfficeCliCheckout(tmp, newDate);
        createInstalledOfficeCli(tmp, oldDate);
        assert.equal(withPath(binDir, () => shouldRunLocalOfficeCliInstall(projectRoot)), true);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
});

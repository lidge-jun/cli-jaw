import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    shouldRequireCliToolsDuringPostinstall,
    shouldRequireOfficeCliDuringPostinstall,
} from '../../bin/postinstall.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const postinstallSrc = readFileSync(join(root, 'bin/postinstall.ts'), 'utf8');

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

test('postinstall strict env helpers accept explicit and npm-config flags', () => {
    assert.equal(shouldRequireOfficeCliDuringPostinstall({}), false);
    assert.equal(shouldRequireOfficeCliDuringPostinstall({ CLI_JAW_REQUIRE_OFFICECLI: '1' }), true);
    assert.equal(shouldRequireOfficeCliDuringPostinstall({ npm_config_jaw_require_officecli: 'true' }), true);

    assert.equal(shouldRequireCliToolsDuringPostinstall({}), false);
    assert.equal(shouldRequireCliToolsDuringPostinstall({ CLI_JAW_REQUIRE_CLI_TOOLS: '1' }), true);
    assert.equal(shouldRequireCliToolsDuringPostinstall({ npm_config_jaw_require_cli_tools: 'true' }), true);
});

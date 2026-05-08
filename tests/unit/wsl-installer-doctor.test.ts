import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const installerSrc = fs.readFileSync(join(root, 'scripts/install-wsl.sh'), 'utf8');
const doctorSrc = fs.readFileSync(join(root, 'bin/commands/doctor.ts'), 'utf8');

test('WSL installer configures user-local npm prefix', () => {
    assert.ok(installerSrc.includes('npm config set prefix "$prefix"'));
    assert.ok(installerSrc.includes('NPM_PATH_LINE=\'export PATH="$HOME/.local/bin:$PATH"\''));
    assert.ok(installerSrc.includes('add_npm_path_to_profile "$HOME/.bashrc"'));
    assert.ok(installerSrc.includes('add_npm_path_to_profile "$HOME/.profile"'));
    assert.equal(installerSrc.includes('[ -f "$HOME/.zshrc" ] && profile="$HOME/.zshrc"'), false);
});

test('WSL installer makes jaw and bundled CLI tools available immediately', () => {
    assert.ok(installerSrc.includes('CLI_JAW_INSTALL_CLI_TOOLS=1'));
    assert.ok(installerSrc.includes('CLI_JAW_REQUIRE_CLI_TOOLS=1'));
    assert.ok(installerSrc.includes('CLI_JAW_REQUIRE_OFFICECLI=1'));
    assert.ok(installerSrc.includes('verify_jaw_command'));
    assert.ok(installerSrc.includes('command -v jaw'));
    assert.ok(installerSrc.includes('jaw --version >/dev/null 2>&1 || fail "jaw is on PATH but failed to run"'));
    assert.ok(installerSrc.includes('hash -r 2>/dev/null || true'));
    assert.equal(installerSrc.includes("|| echo 'done'"), false);
    assert.ok(installerSrc.includes('CLI_JAW_SOURCE_ONLY'));
});

test('WSL installer installs browser and OfficeCLI helpers', () => {
    assert.ok(installerSrc.includes('npm install -g playwright-core'));
    assert.ok(installerSrc.includes('install_officecli'));
    assert.ok(installerSrc.includes('verify_officecli_command'));
    assert.ok(installerSrc.includes('officecli --version'));
    assert.ok(installerSrc.includes('OfficeCLI install failed. Expected executable at $officecli_bin'));
    assert.equal(installerSrc.includes('OfficeCLI install failed — rerun later'), false);
    assert.equal(installerSrc.includes('OfficeCLI installer not found in global package — skipping'), false);
    assert.ok(installerSrc.includes('install-browser') === false);
});

test('doctor exposes WSL permission and OfficeCLI checks', () => {
    assert.ok(doctorSrc.includes("check('WSL sudo'"));
    assert.ok(doctorSrc.includes("check('npm global prefix'"));
    assert.ok(doctorSrc.includes("check('OfficeCLI'"));
    assert.ok(doctorSrc.includes('verifyOfficeCli'));
    assert.ok(doctorSrc.includes("execFileSync(candidate, ['--version']"));
    assert.ok(doctorSrc.includes('sudoNonInteractive'));
    assert.ok(doctorSrc.includes('npmPrefix'));
});

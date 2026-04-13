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
    assert.ok(installerSrc.includes('export PATH="$HOME/.local/bin:$PATH"'));
});

test('WSL installer installs browser and OfficeCLI helpers', () => {
    assert.ok(installerSrc.includes('npm install -g playwright-core'));
    assert.ok(installerSrc.includes('install_officecli'));
    assert.ok(installerSrc.includes('install-browser') === false);
});

test('doctor exposes WSL permission and OfficeCLI checks', () => {
    assert.ok(doctorSrc.includes("check('WSL sudo'"));
    assert.ok(doctorSrc.includes("check('npm global prefix'"));
    assert.ok(doctorSrc.includes("check('OfficeCLI'"));
    assert.ok(doctorSrc.includes('sudoNonInteractive'));
    assert.ok(doctorSrc.includes('npmPrefix'));
});

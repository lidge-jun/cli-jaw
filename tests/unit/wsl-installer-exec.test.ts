import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const installerPath = join(root, 'scripts', 'install-wsl.sh');

function writeExecutable(path: string, content: string): void {
    writeFileSync(path, content);
    chmodSync(path, 0o755);
}

function runInstallerSnippet(snippet: string, setup?: (home: string, bin: string) => void): { status: number | null; output: string; home: string } {
    const home = mkdtempSync(join(tmpdir(), 'jaw-wsl-installer-'));
    const bin = join(home, 'fake-bin');
    mkdirSync(bin, { recursive: true });
    setup?.(home, bin);
    const script = `
set -euo pipefail
export HOME=${JSON.stringify(home)}
export PATH=${JSON.stringify(bin)}:$PATH
export CLI_JAW_SOURCE_ONLY=1
source ${JSON.stringify(installerPath)}
${snippet}
`;
    const result = spawnSync('bash', ['-lc', script], {
        encoding: 'utf8',
        env: {
            ...process.env,
            HOME: home,
            PATH: `${bin}:${process.env["PATH"] || ''}`,
            CLI_JAW_SOURCE_ONLY: '1',
        },
    });
    return {
        status: result.status,
        output: `${result.stdout || ''}${result.stderr || ''}`,
        home,
    };
}

test('WSL installer fails when jaw is present but not runnable', () => {
    const result = runInstallerSnippet('verify_jaw_command', (home) => {
        mkdirSync(join(home, '.local', 'bin'), { recursive: true });
        writeExecutable(join(home, '.local', 'bin', 'jaw'), '#!/usr/bin/env bash\nexit 7\n');
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /jaw is on PATH but failed to run/);
    rmSync(result.home, { recursive: true, force: true });
});

test('WSL installer writes profile PATH and makes jaw available in current shell', () => {
    const result = runInstallerSnippet('configure_npm_prefix\nverify_jaw_command\nprintf "PATH=%s\\n" "$PATH"', (home, bin) => {
        writeExecutable(join(bin, 'npm'), '#!/usr/bin/env bash\nif [ "$1" = "config" ] && [ "$2" = "get" ]; then echo "$HOME/.local"; exit 0; fi\nexit 0\n');
        mkdirSync(join(home, '.local', 'bin'), { recursive: true });
        writeExecutable(join(home, '.local', 'bin', 'jaw'), '#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "2.0.0"; exit 0; fi\nexit 0\n');
    });
    assert.equal(result.status, 0, result.output);
    assert.match(readFileSync(join(result.home, '.bashrc'), 'utf8'), /\$HOME\/\.local\/bin/);
    assert.match(readFileSync(join(result.home, '.profile'), 'utf8'), /\$HOME\/\.local\/bin/);
    assert.match(result.output, new RegExp(`PATH=${result.home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.local/bin`));
    rmSync(result.home, { recursive: true, force: true });
});

test('WSL installer fails when OfficeCLI is present but not runnable', () => {
    const result = runInstallerSnippet('verify_officecli_command', (home, bin) => {
        mkdirSync(join(home, '.local', 'bin'), { recursive: true });
        writeExecutable(join(bin, 'officecli'), '#!/usr/bin/env bash\nexit 9\n');
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /OfficeCLI is on PATH but failed to run/);
    rmSync(result.home, { recursive: true, force: true });
});

test('WSL installer fails when packaged OfficeCLI installer is missing', () => {
    const result = runInstallerSnippet('install_officecli', (_home, bin) => {
        const root = mkdtempSync(join(tmpdir(), 'jaw-global-root-'));
        writeExecutable(join(bin, 'npm'), `#!/usr/bin/env bash\nif [ "$1" = "root" ]; then echo ${JSON.stringify(root)}; exit 0; fi\nexit 0\n`);
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /OfficeCLI installer not found in global package/);
    rmSync(result.home, { recursive: true, force: true });
});

test('WSL installer fails when packaged OfficeCLI installer exits nonzero', () => {
    const result = runInstallerSnippet('install_officecli', (_home, bin) => {
        const globalRoot = mkdtempSync(join(tmpdir(), 'jaw-global-root-'));
        const installerDir = join(globalRoot, 'cli-jaw', 'scripts');
        mkdirSync(installerDir, { recursive: true });
        writeExecutable(join(installerDir, 'install-officecli.sh'), '#!/usr/bin/env bash\nexit 5\n');
        writeExecutable(join(bin, 'npm'), `#!/usr/bin/env bash\nif [ "$1" = "root" ]; then echo ${JSON.stringify(globalRoot)}; exit 0; fi\nexit 0\n`);
    });
    assert.notEqual(result.status, 0);
    rmSync(result.home, { recursive: true, force: true });
});

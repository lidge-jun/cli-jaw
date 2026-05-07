import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readSource } from './source-normalize.js';
import {
    classifyInstallerFromPath,
    shouldDedupeCliTools,
    shouldInstallCliToolsDuringPostinstall,
} from '../../bin/postinstall.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const postinstallSrc = readSource(join(__dirname, '../../bin/postinstall.ts'), 'utf8');
const initSrc = readSource(join(__dirname, '../../bin/commands/init.ts'), 'utf8');
const officeCliShellSrc = readSource(join(__dirname, '../../scripts/install-officecli.sh'), 'utf8');
const officeCliPowerShellSrc = readSource(join(__dirname, '../../scripts/install-officecli.ps1'), 'utf8');
const readmeSrc = readSource(join(__dirname, '../../README.md'), 'utf8');

// ── SAF-001: safe guard with JAW_SAFE ──

test('SAF-001: postinstall has JAW_SAFE safe mode guard', () => {
    assert.ok(postinstallSrc.includes("JAW_SAFE === '1'"), 'checks JAW_SAFE');
    assert.ok(postinstallSrc.includes("JAW_SAFE === 'true'"), 'checks JAW_SAFE=true');
});

// ── SAF-002: safe guard with npm_config_jaw_safe ──

test('SAF-002: postinstall has npm_config_jaw_safe guard', () => {
    assert.ok(postinstallSrc.includes("npm_config_jaw_safe === '1'"), 'checks npm_config_jaw_safe=1');
    assert.ok(postinstallSrc.includes("npm_config_jaw_safe === 'true'"), 'checks npm_config_jaw_safe=true');
});

test('SAF-002b: README documents safe install/update before normal install', () => {
    const safePos = readmeSrc.indexOf('JAW_SAFE=1 npm install -g cli-jaw');
    const normalPos = readmeSrc.indexOf('npm install -g cli-jaw');
    assert.ok(safePos >= 0, 'README should document macOS/Linux JAW_SAFE install');
    assert.ok(readmeSrc.includes('$env:JAW_SAFE="1"; npm install -g cli-jaw'), 'README should document PowerShell JAW_SAFE install');
    assert.ok(readmeSrc.includes('skips optional tool/runtime setup'), 'README should explain safe install boundary');
    assert.ok(safePos <= normalPos, 'safe install should appear before normal install example');
});

// ── SAF-003: safe guard exits early ──

test('SAF-003: safe mode returns early (no side effects)', () => {
    const guardStart = postinstallSrc.indexOf('if (isSafeMode)');
    const guardBlock = postinstallSrc.slice(guardStart, guardStart + 500);
    assert.ok(guardBlock.includes('return'), 'returns early in safe mode');
    assert.ok(guardBlock.includes('safe mode'), 'prints safe mode message');
});

// ── SAF-004: installCliTools exported ──

test('SAF-004: installCliTools is exported', () => {
    assert.ok(postinstallSrc.includes('export async function installCliTools'), 'installCliTools exported');
});

test('SAF-004b: postinstall skips CLI tool install/update by default', () => {
    assert.equal(shouldInstallCliToolsDuringPostinstall({}), false);
    assert.equal(shouldInstallCliToolsDuringPostinstall({ CLI_JAW_INSTALL_CLI_TOOLS: '1' }), true);
    assert.equal(shouldInstallCliToolsDuringPostinstall({ npm_config_jaw_install_cli_tools: 'true' }), true);

    const runBlock = postinstallSrc.slice(postinstallSrc.indexOf('export async function runPostinstall'));
    assert.ok(runBlock.includes('shouldInstallCliToolsDuringPostinstall()'), 'runPostinstall must gate installCliTools');
    assert.ok(runBlock.includes('CLI tool install/update skipped by default'), 'default skip must be visible');
});

test('SAF-004c: duplicate CLI uninstall is opt-in', () => {
    assert.equal(shouldDedupeCliTools({}), false);
    assert.equal(shouldDedupeCliTools({ CLI_JAW_DEDUPE_CLI_TOOLS: '1' }), true);
    assert.equal(shouldDedupeCliTools({ npm_config_jaw_dedupe_cli_tools: 'true' }), true);

    const dedupeBlock = postinstallSrc.slice(postinstallSrc.indexOf('function deduplicateCliTool'));
    assert.ok(dedupeBlock.includes('shouldDedupeCliTools()'), 'dedupe must be opt-in before uninstall');
    assert.ok(dedupeBlock.includes('not removing automatically'), 'dedupe default must avoid uninstalling user tools');
});

test('SAF-004d: Homebrew Node npm globals are classified as npm before brew', () => {
    assert.equal(
        classifyInstallerFromPath('/opt/homebrew/bin/codex', {
            binName: 'codex',
            npmPrefix: '/opt/homebrew',
            realPath: '/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js',
        }),
        'npm',
    );
    assert.equal(
        classifyInstallerFromPath('/usr/local/bin/gemini', {
            binName: 'gemini',
            npmPrefix: '/usr/local',
            realPath: '/usr/local/lib/node_modules/@google/gemini-cli/dist/index.js',
        }),
        'npm',
    );
    assert.equal(
        classifyInstallerFromPath('/opt/homebrew/bin/gemini', {
            binName: 'gemini',
            npmPrefix: '/opt/homebrew',
            realPath: '/opt/homebrew/Cellar/gemini-cli/1.2.3/bin/gemini',
        }),
        'brew',
    );
    assert.equal(
        classifyInstallerFromPath('/opt/homebrew/bin/codex', {
            binName: 'codex',
            npmPrefix: '/Users/test/.nvm/versions/node/v22.0.0',
            realPath: '/opt/homebrew/bin/codex',
        }),
        null,
    );
});

// ── SAF-005: installMcpServers exported ──

test('SAF-005: installMcpServers is exported', () => {
    assert.ok(postinstallSrc.includes('export async function installMcpServers'), 'installMcpServers exported');
});

// ── SAF-006: installSkillDeps exported ──

test('SAF-006: installSkillDeps is exported', () => {
    assert.ok(postinstallSrc.includes('export async function installSkillDeps'), 'installSkillDeps exported');
});

test('SAF-006b: installOfficeCli is exported', () => {
    assert.ok(postinstallSrc.includes('export async function installOfficeCli'), 'installOfficeCli exported');
});

test('SAF-006c: runPostinstall calls installOfficeCli', () => {
    assert.ok(postinstallSrc.includes('await installOfficeCli();'), 'runPostinstall should call installOfficeCli');
});

// ── SAF-007: InstallOpts type exported ──

test('SAF-007: InstallOpts type is exported', () => {
    assert.ok(postinstallSrc.includes('export type InstallOpts'), 'InstallOpts type exported');
});

// ── SAF-008: dryRun support in all 3 functions ──

test('SAF-008: all install functions support dryRun', () => {
    const cliBlock = postinstallSrc.slice(postinstallSrc.indexOf('installCliTools'));
    const mcpBlock = postinstallSrc.slice(postinstallSrc.indexOf('installMcpServers'));
    const depsBlock = postinstallSrc.slice(postinstallSrc.indexOf('installSkillDeps'));
    const officeBlock = postinstallSrc.slice(postinstallSrc.indexOf('installOfficeCli'));
    assert.ok(cliBlock.includes('opts.dryRun'), 'installCliTools supports dryRun');
    assert.ok(mcpBlock.includes('opts.dryRun'), 'installMcpServers supports dryRun');
    assert.ok(depsBlock.includes('opts.dryRun'), 'installSkillDeps supports dryRun');
    assert.ok(officeBlock.includes('opts.dryRun'), 'installOfficeCli supports dryRun');
});

// ── SAF-009: isEntryPoint guard ──

test('SAF-009: postinstall has isEntryPoint guard', () => {
    assert.ok(postinstallSrc.includes('isEntryPoint'), 'checks isEntryPoint');
    assert.ok(postinstallSrc.includes("endsWith('postinstall"), 'checks postinstall filename');
    assert.ok(postinstallSrc.includes('runPostinstall()'), 'calls runPostinstall from guard');
});

// ── SAF-010: safe mode guard runs before skills/uploads creation ──

test('SAF-010: safe mode guard is before skills/uploads ensureDir', () => {
    const guardPos = postinstallSrc.indexOf('if (isSafeMode)');
    const skillsDirPos = postinstallSrc.indexOf("ensureDir(path.join(jawHome, 'skills'))");
    const uploadsDirPos = postinstallSrc.indexOf("ensureDir(path.join(jawHome, 'uploads'))");
    assert.ok(guardPos < skillsDirPos, 'safe guard before skills dir creation');
    assert.ok(guardPos < uploadsDirPos, 'safe guard before uploads dir creation');
});

// ── INIT-001: --dry-run option ──

test('INIT-001: init.ts has --dry-run option', () => {
    assert.ok(initSrc.includes("'dry-run': { type: 'boolean'"), '--dry-run option defined');
});

// ── INIT-002: --safe option (safe install mode) ──

test('INIT-002: init.ts has --safe option for safe install mode', () => {
    assert.ok(initSrc.includes("safe: { type: 'boolean'"), '--safe option defined in parseArgs');
    assert.ok(initSrc.includes('--safe                Ask before optional installs'), '--safe help should describe prompt behavior');
    assert.ok(!initSrc.includes('--safe                Safe install (home dir only)'), '--safe help should not promise home-only behavior');
});

// ── INIT-003: no direct import('../postinstall.js') side-effect ──

test('INIT-003: init.ts uses dynamic import for postinstall (no static side-effect)', () => {
    const hasStaticImport = /^import\s+\{[^}]+\}\s+from\s+['"]\.\.[\\/]postinstall/m.test(initSrc);
    assert.ok(!hasStaticImport, 'no static import of postinstall (would cause side effects)');
    assert.ok(
        initSrc.includes("await import('../postinstall.js')"),
        'uses dynamic import() for controlled loading',
    );
});

// ── INIT-004: uses extracted functions ──

test('INIT-004: init.ts imports and calls extracted install functions', () => {
    assert.ok(initSrc.includes('installCliTools'), 'calls installCliTools');
    assert.ok(initSrc.includes('installMcpServers'), 'calls installMcpServers');
    assert.ok(initSrc.includes('installSkillDeps'), 'calls installSkillDeps');
    assert.ok(initSrc.includes('installOfficeCli'), 'calls installOfficeCli');
});

// ── INIT-005: --dry-run skips settings write ──

test('INIT-005: --dry-run guards settings/dir writes', () => {
    assert.ok(initSrc.includes("!values['dry-run']"), 'dry-run guards file writes');
    assert.ok(initSrc.includes('[dry-run] would save settings'), 'dry-run reports settings skip');
});

test('OFF-001: shell installer supports update mode', () => {
    assert.ok(officeCliShellSrc.includes('--update'), 'shell installer should expose --update');
    assert.ok(officeCliShellSrc.includes('get_latest_version'), 'shell installer should compare latest version');
});

test('OFF-001b: shell installer fails on checksum mismatch when expected checksum exists', () => {
    const mismatchPos = officeCliShellSrc.indexOf('Checksum mismatch');
    assert.ok(mismatchPos >= 0, 'shell installer should report checksum mismatch');
    const mismatchBlock = officeCliShellSrc.slice(Math.max(0, mismatchPos - 80), mismatchPos + 160);
    assert.ok(mismatchBlock.includes('fail "Checksum mismatch'), 'checksum mismatch should fail, not warn');
    assert.ok(!mismatchBlock.includes('warn "Checksum mismatch'), 'checksum mismatch must not continue as warning');
});

test('OFF-002: PowerShell installer exists for win32 postinstall', () => {
    assert.ok(officeCliPowerShellSrc.includes('officecli-win-x64.exe'), 'PowerShell installer should map Windows x64 asset');
    assert.ok(officeCliPowerShellSrc.includes('$env:LOCALAPPDATA'), 'PowerShell installer should install under LOCALAPPDATA');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readSource } from './source-normalize.js';
import {
    classifyInstallerFromPath,
    shouldDedupeCliTools,
    shouldForceClaudeDuringPostinstall,
    shouldInstallClaudeDuringPostinstall,
    shouldInstallCliToolsDuringPostinstall,
} from '../../bin/postinstall.js';
import { classifyClaudeInstall } from '../../src/core/claude-install.js';

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
    assert.equal(shouldInstallClaudeDuringPostinstall({}), true);
    assert.equal(shouldInstallClaudeDuringPostinstall({ CLI_JAW_SKIP_CLAUDE: '1' }), false);
    assert.equal(shouldInstallClaudeDuringPostinstall({ npm_config_jaw_skip_claude: 'true' }), false);
    assert.equal(shouldForceClaudeDuringPostinstall({}), false);
    assert.equal(shouldForceClaudeDuringPostinstall({ CLI_JAW_FORCE_CLAUDE: '1' }), true);
    assert.equal(shouldForceClaudeDuringPostinstall({ npm_config_jaw_force_claude: 'true' }), true);

    const runBlock = postinstallSrc.slice(postinstallSrc.indexOf('export async function runPostinstall'));
    assert.ok(runBlock.includes('shouldInstallCliToolsDuringPostinstall()'), 'runPostinstall must gate installCliTools');
    assert.ok(runBlock.includes('shouldInstallClaudeDuringPostinstall()'), 'runPostinstall must install Claude unless explicitly skipped');
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

test('SAF-004c2: npm duplicate cleanup only runs after cli-jaw installs npm', () => {
    const dedupeBlock = postinstallSrc.slice(postinstallSrc.indexOf('function deduplicateCliTool'));
    assert.ok(dedupeBlock.includes('preferredActive?: PkgMgr'), 'dedupe should accept the manager postinstall intentionally used');
    assert.ok(dedupeBlock.includes('isInstalledVia(preferredActive'), 'dedupe should verify the preferred manager was actually installed');
    assert.ok(
        postinstallSrc.includes("deduplicateCliTool(bin, pkg, brew, 'npm')"),
        'dedupe should prefer npm only when cli-jaw actually installed npm',
    );
    assert.ok(!postinstallSrc.includes('deduplicateCliTool(bin, pkg, brew, forceMgr)'), 'forceMgr should not force duplicate cleanup');
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

test('SAF-004e: Claude CLI install uses the official native installer', () => {
    const cliBlock = postinstallSrc.slice(
        postinstallSrc.indexOf('function buildClaudeNativeInstallCmd'),
        postinstallSrc.indexOf('const MCP_PACKAGES'),
    );
    assert.ok(postinstallSrc.includes('https://claude.ai/install.sh'), 'Claude install should use the official native installer');
    assert.ok(postinstallSrc.includes('https://claude.ai/install.ps1'), 'Windows Claude install should use the official native PowerShell installer');
    assert.ok(cliBlock.includes('CLAUDE_NATIVE_INSTALL_URL'), 'Claude install command should route through the native installer URL');
    assert.ok(cliBlock.includes('CLAUDE_NATIVE_INSTALL_PS_URL'), 'Windows Claude install command should route through the native installer URL');
    assert.ok(cliBlock.includes('execFileSync'), 'Windows Claude install should avoid cmd.exe nested quote parsing');
    assert.ok(cliBlock.includes('findClaudeNativeBinary'), 'postinstall should verify the native Claude binary location');
    assert.ok(cliBlock.includes('findExistingClaudeBinary'), 'postinstall should check existing Claude before installing');
    assert.ok(cliBlock.includes('isSpawnableCliFile'), 'postinstall should avoid accepting broken Unix Claude shims as existing installs');
    assert.ok(cliBlock.includes('findExistingCliBinary'), 'postinstall existing-Claude detection should use the shared PATH scanner');
    assert.ok(postinstallSrc.includes('detectCliBinary(name'), 'shared existing-CLI detection should scan all PATH candidates');
    assert.ok(cliBlock.includes('claude already present'), 'postinstall should skip reinstalling existing Claude by default');
    assert.ok(cliBlock.includes('shouldForceClaudeDuringPostinstall()'), 'postinstall should expose an explicit force-update path for native Claude');
    assert.ok(cliBlock.includes('claude (native installer)'), 'strict failure reporting should identify the native installer path');
    assert.ok(!cliBlock.includes("process.platform === 'win32' && found"), 'Windows success must require a native Claude binary');
});

test('SAF-004e1: Claude postinstall skips runnable existing CLIs, including Bun/npm installs', () => {
    const installBlock = postinstallSrc.slice(
        postinstallSrc.indexOf('function isRunnableClaudeBinary'),
        postinstallSrc.indexOf('/** Check if a package is installed via a specific manager'),
    );
    assert.ok(installBlock.includes('function isRunnableClaudeBinary'), 'existing Claude should be validated by execution');
    assert.ok(installBlock.includes('isRunnableCliBinary'), 'validation should use the shared --version check');
    assert.ok(installBlock.includes('isRunnableClaudeBinary(existingPath)'), 'runnable existing Claude should skip install');
    assert.ok(installBlock.includes('claude already present'), 'postinstall should still skip working existing Claude');
    assert.ok(!installBlock.includes('non-native claude detected'), 'postinstall must not treat Bun/npm Claude as broken solely by installer kind');
});

test('SAF-004e1b: Claude runnable check is explicit for Windows and Unix', () => {
    const checkBlock = postinstallSrc.slice(
        postinstallSrc.indexOf('function runCliVersionCheck'),
        postinstallSrc.indexOf('function isRunnableClaudeBinary'),
    );
    assert.ok(checkBlock.includes("process.platform === 'win32'"), 'Windows must use its own version-check branch');
    assert.ok(checkBlock.includes("execFileSync('powershell'"), 'Windows check should use PowerShell for .cmd/.exe paths');
    assert.ok(checkBlock.includes("'& $args[0] --version'"), 'PowerShell should invoke the detected Claude path safely');
    assert.ok(checkBlock.includes("execFileSync(binaryPath, ['--version']"), 'macOS/Linux should run the detected binary directly');
});

test('SAF-004e2: Claude native install classification covers Windows native path', () => {
    assert.equal(classifyClaudeInstall(join(os.homedir(), '.local', 'bin', 'claude')), 'native');
    assert.equal(classifyClaudeInstall(join(os.homedir(), '.local', 'bin', 'claude.exe')), 'native');
});

test('SAF-004f: bundled non-Claude CLI tools preserve runnable installs before using npm', () => {
    const packageBlock = postinstallSrc.slice(
        postinstallSrc.indexOf('const CLI_PACKAGES'),
        postinstallSrc.indexOf('type PkgMgr'),
    );
    assert.ok(packageBlock.includes("{ bin: 'codex', pkg: '@openai/codex' }"), 'codex should be listed');
    assert.ok(packageBlock.includes("{ bin: 'gemini', pkg: '@google/gemini-cli' }"), 'gemini should be listed');
    assert.ok(packageBlock.includes("{ bin: 'copilot', pkg: '@github/copilot' }"), 'copilot should be listed');
    assert.ok(packageBlock.includes("{ bin: 'opencode', pkg: 'opencode-ai' }"), 'opencode should be listed');
    assert.ok(!packageBlock.includes('forceMgr'), 'non-Claude CLIs should not force-reinstall over another package manager');
    assert.ok(!packageBlock.includes("brew: 'gemini-cli'"), 'gemini should not route through brew');

    const installBlock = postinstallSrc.slice(postinstallSrc.indexOf('export async function installCliTools'));
    assert.ok(installBlock.includes('const existingPath = findExistingCliBinary(bin)'), 'install should detect existing CLIs first');
    assert.ok(installBlock.includes('isRunnableCliBinary(bin, existingPath)'), 'existing CLIs should be validated by --version');
    assert.ok(installBlock.includes('${bin} already present'), 'runnable existing CLIs should be skipped');
    assert.ok(installBlock.includes("buildInstallCmd('npm', pkg, brew)"), 'missing or broken CLIs should install via npm');
    assert.ok(!installBlock.includes('detectDefaultPkgMgr'), 'Bun presence should not redirect fresh installs to Bun');
});

test('SAF-004g: postinstall child processes use service-safe PATH consistently', () => {
    assert.ok(postinstallSrc.includes('function postinstallExecEnv'), 'postinstall should centralize child-process env construction');
    assert.ok(postinstallSrc.includes('delete out.PATH'), 'postinstall env should avoid duplicate PATH variants');
    assert.ok(postinstallSrc.includes('delete out.Path'), 'postinstall env should avoid duplicate Windows Path variants');
    assert.ok(postinstallSrc.includes("process.platform === 'win32' ? 'Path' : 'PATH'"), 'postinstall env should use one platform-appropriate PATH key');

    const depsBlock = postinstallSrc.slice(postinstallSrc.indexOf('export async function installSkillDeps'));
    assert.ok(depsBlock.includes('env: postinstallExecEnv()'), 'skill dependency checks/installers should see service-safe PATH');

    const installBlock = postinstallSrc.slice(postinstallSrc.indexOf('export async function installCliTools'));
    assert.ok(installBlock.includes('env: postinstallExecEnv()'), 'CLI package installs should see service-safe PATH');

    const mcpBlock = postinstallSrc.slice(postinstallSrc.indexOf('export async function installMcpServers'));
    assert.ok(mcpBlock.includes('env: postinstallExecEnv()'), 'MCP global installs should see service-safe PATH');
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

test('OFF-002b: win32 OfficeCLI failure hint points to PowerShell installer', () => {
    const windowsBlock = postinstallSrc.slice(
        postinstallSrc.indexOf("if (process.platform === 'win32')"),
        postinstallSrc.indexOf("const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'install-officecli.sh')"),
    );
    assert.ok(windowsBlock.includes('install-officecli.ps1'), 'Windows failure hint should mention the PowerShell installer');
    assert.ok(!windowsBlock.includes('run manually: install-officecli.sh'), 'Windows failure hint must not point to the Unix shell installer');
});

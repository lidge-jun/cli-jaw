#!/usr/bin/env node

// ─── Node version guard ─────────────────────────────
const [major] = process.versions.node.split('.').map(Number);
if (major! < 22) {
    console.error(`[jaw:init] ❌ Node.js >= 22 required (current: ${process.version})`);
    console.error(`[jaw:init]    Install: https://nodejs.org or nvm install 22`);
    process.exit(1);
}

/**
 * postinstall.js — Phase 12.1
 * Sets up symlink structure and MCP config for agent tool compatibility.
 *
 * Created structure (isolated-by-default):
 *   ~/.cli-jaw/           (config dir)
 *   ~/.cli-jaw/skills/    (default skills source)
 *   ~/.cli-jaw/uploads/   (media uploads)
 *   ~/.cli-jaw/mcp.json   (unified MCP config)
 *
 * Shared home paths (~/.agents, ~/.agent, ~/.claude) are NOT modified by default.
 * Opt-in: CLI_JAW_MIGRATE_SHARED_PATHS=1 npm install -g cli-jaw
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, execFileSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { ensureSharedHomeSkillsLinks, initMcpConfig, copyDefaultSkills, propagateSkillsToInstances, loadUnifiedMcp, saveUnifiedMcp } from '../lib/mcp-sync.js';
import { resolveHomePath } from '../src/core/path-expand.js';
import { buildServicePath } from '../src/core/runtime-path.js';
import { classifyClaudeInstall } from '../src/core/claude-install.js';
import { detectCliBinary, isSpawnableCliFile } from '../src/core/cli-detect.js';
import { asArray, asRecord, errString, fieldString } from './_http-client.js';

// ─── JAW_HOME inline (config.ts → registry.ts import 체인 제거) ───
const JAW_HOME = process.env["CLI_JAW_HOME"]
    ? resolveHomePath(process.env["CLI_JAW_HOME"])
    : path.join(os.homedir(), '.cli-jaw');

const home = os.homedir();
const jawHome = JAW_HOME;
const PATH_LOOKUP_CMD = process.platform === 'win32' ? 'where' : 'which';
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = fs.existsSync(path.join(MODULE_DIR, '..', '..', 'scripts'))
    ? path.resolve(MODULE_DIR, '..', '..')
    : path.resolve(MODULE_DIR, '..');
const OFFICECLI_DEFAULT_REPO = 'lidge-jun/OfficeCLI';
const OFFICECLI_SKIP = process.env["CLI_JAW_SKIP_OFFICECLI"] === '1'
    || process.env["CLI_JAW_SKIP_OFFICECLI"] === 'true';
const OFFICECLI_FORCE = process.env["CLI_JAW_FORCE_OFFICECLI"] === '1'
    || process.env["CLI_JAW_FORCE_OFFICECLI"] === 'true';
const OFFICECLI_REQUIRE = shouldRequireOfficeCliDuringPostinstall();
const CLAUDE_NATIVE_INSTALL_URL = 'https://claude.ai/install.sh';
const CLAUDE_NATIVE_INSTALL_PS_URL = 'https://claude.ai/install.ps1';

// ─── Legacy migration ───
// Moved into runPostinstall() to prevent side effects on dynamic import.
// (init.ts imports this module for installCliTools/etc — must not trigger fs.renameSync)

function postinstallExecEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const currentPath = env["PATH"] || env["Path"] || env["path"] || '';
    const safePath = buildServicePath(currentPath);
    const out: NodeJS.ProcessEnv = { ...env };
    delete out["PATH"];
    delete out["Path"];
    delete out["path"];
    out[process.platform === 'win32' ? 'Path' : 'PATH'] = safePath;
    return out;
}

function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[jaw:init] created ${dir}`);
    }
}

function ensureSymlink(target: string, linkPath: string) {
    if (fs.existsSync(linkPath)) return false;
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    try {
        fs.symlinkSync(target, linkPath);
        console.log(`[jaw:init] symlink: ${linkPath} → ${target}`);
        return true;
    } catch (e: unknown) {
        const err = asRecord(e);
        if (process.platform === 'win32' && (err["code"] === 'EPERM' || err["code"] === 'UNKNOWN')) {
            try {
                const stat = fs.statSync(target);
                if (stat.isDirectory()) {
                    fs.symlinkSync(target, linkPath, 'junction');
                } else {
                    fs.copyFileSync(target, linkPath);
                }
                console.log(`[jaw:init] fallback link: ${linkPath} → ${target}`);
                return true;
            } catch (fallbackErr: unknown) {
                console.error(`[jaw:init] ⚠️ symlink fallback failed: ${linkPath} (${errString(fallbackErr) || 'unknown'})`);
                return false;
            }
        }
        console.error(`[jaw:init] ⚠️ symlink failed: ${linkPath} (${errString(e) || 'unknown'})`);
        return false;
    }
}

function findBinaryPath(name: string): string | null {
    try {
        const out = execFileSync(PATH_LOOKUP_CMD, [name], {
            encoding: 'utf8',
            stdio: 'pipe',
            timeout: 5000,
            env: postinstallExecEnv(),
        }).trim();
        const first = out.split(/\r?\n/).map(x => x.trim()).find(Boolean);
        return first || null;
    } catch {
        return null;
    }
}

interface SkillsSymlinkLink {
    action?: unknown;
    status?: unknown;
    backupPath?: unknown;
    linkPath?: unknown;
    message?: unknown;
}

interface SkillsSymlinkReport {
    links?: SkillsSymlinkLink[];
}

function logSkillsSymlinkReport(report: SkillsSymlinkReport) {
    const links = asArray<SkillsSymlinkLink>(report.links);
    if (!links.length) return;

    const moved = links.filter((x) => x.action === 'backup_replace');
    if (moved.length) {
        console.log(`[jaw:init] skills conflicts moved to backup: ${moved.length}`);
        for (const item of moved) {
            const backupPath = fieldString(item.backupPath);
            if (backupPath) {
                console.log(`[jaw:init]   - ${fieldString(item.linkPath)} -> ${backupPath}`);
            }
        }
    }

    const errors = links.filter((x) => x.status === 'error');
    for (const item of errors) {
        console.log(`[jaw:init] ⚠️ symlink error: ${fieldString(item.linkPath)} (${fieldString(item.message, 'unknown')})`);
    }
}


/**
 * 업그레이드 유저의 launchd plist가 ProcessType 키 없으면 새 format으로 재등록.
 * Fresh install(plist 없음)은 skip — jaw launchd 명시 실행 시점에 생성됨.
 */
async function maybeReregisterLaunchd() {
    if (process.platform !== 'darwin') return;
    const label = 'com.cli-jaw.default';
    const plistPath = path.join(home, 'Library', 'LaunchAgents', `${label}.plist`);
    if (!fs.existsSync(plistPath)) return;

    try {
        const content = fs.readFileSync(plistPath, 'utf8');
        if (content.includes('<key>ProcessType</key>')) {
            console.log('[jaw:init] ⏭️  launchd plist 이미 최신 포맷');
            return;
        }
    } catch {
        return;
    }

    console.log('[jaw:init] 🔄 launchd plist 구 포맷 감지 — 새 포맷으로 재등록 시도');
    const jawBin = findBinaryPath('jaw') || findBinaryPath('cli-jaw');
    if (!jawBin) {
        console.warn('[jaw:init] ⚠️  jaw 바이너리 탐색 실패 — 수동: jaw launchd');
        return;
    }
    try {
        execFileSync(jawBin, ['launchd'], { stdio: 'inherit', timeout: 30000, env: postinstallExecEnv() });
    } catch (e: unknown) {
        console.warn(`[jaw:init] ⚠️  launchd 재등록 실패 — 수동: jaw launchd`);
        const message = errString(e);
        if (message) console.warn(`   ${message.slice(0, 120)}`);
    }
}

// ─── Exported install functions (module-level, no side effects) ─────

export type InstallOpts = {
    dryRun?: boolean;
    interactive?: boolean;
    ask?: (question: string, defaultVal: string) => Promise<string>;
};

export async function installOfficeCli(opts: InstallOpts = {}) {
    if (OFFICECLI_REQUIRE && OFFICECLI_SKIP) {
        throw new Error('OfficeCLI install required but CLI_JAW_SKIP_OFFICECLI is set');
    }

    if (OFFICECLI_SKIP) {
        console.log('[jaw:init] ⏭️  officecli skipped (CLI_JAW_SKIP_OFFICECLI)');
        return;
    }

    const repo = process.env["OFFICECLI_REPO"] || OFFICECLI_DEFAULT_REPO;
    if (opts.interactive && opts.ask) {
        const answer = await opts.ask(`Install/update OfficeCLI (${repo})? [Y/n]`, 'y');
        if (answer.toLowerCase() === 'n') {
            console.log('[jaw:init] ⏭️  skipped officecli');
            return;
        }
    }

    if (process.platform === 'win32') {
        const ps = findBinaryPath('pwsh') || findBinaryPath('powershell');
        const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'install-officecli.ps1');
        if (!ps || !fs.existsSync(scriptPath)) {
            if (OFFICECLI_REQUIRE) throw new Error(`OfficeCLI install required but installer unavailable on win32: ${scriptPath}`);
            console.log('[jaw:init] ⚠️  officecli installer unavailable on win32 — skipped');
            return;
        }
        const args = ps.toLowerCase().includes('powershell')
            ? ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Update']
            : ['-File', scriptPath, '-Update'];
        if (OFFICECLI_FORCE) args.push('-Force');
        if (repo !== OFFICECLI_DEFAULT_REPO) args.push('-Repo', repo);
        if (opts.dryRun) {
            console.log(`  [dry-run] would run ${ps} ${args.join(' ')}`);
            return;
        }
        console.log(`[jaw:init] 📦 ensuring officecli (${repo}) via PowerShell installer...`);
        try {
            execFileSync(ps, args, { stdio: 'inherit', timeout: 180000, env: postinstallExecEnv() });
        } catch (e: unknown) {
            const status = asRecord(e)["status"];
            if (OFFICECLI_REQUIRE) {
                throw new Error(`OfficeCLI install required but failed (exit ${fieldString(status, '?')})`);
            }
            console.warn(`[jaw:init] ⚠️  officecli install failed (exit ${fieldString(status, '?')}); skipping — run manually: powershell -ExecutionPolicy Bypass -File scripts/install-officecli.ps1 -Update`);
        }
        return;
    }

    const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'install-officecli.sh');
    if (!fs.existsSync(scriptPath)) {
        if (OFFICECLI_REQUIRE) throw new Error(`OfficeCLI install required but installer script not found: ${scriptPath}`);
        console.log('[jaw:init] ⚠️  officecli installer script not found — skipped');
        return;
    }
    const args = [scriptPath, '--update'];
    if (OFFICECLI_FORCE) args.push('--force');
    if (opts.dryRun) {
        console.log(`  [dry-run] would run bash ${args.join(' ')}`);
        return;
    }
    console.log(`[jaw:init] 📦 ensuring officecli (${repo}) via shell installer...`);
    try {
        execFileSync('bash', args, {
            stdio: 'inherit',
            timeout: 180000,
            env: postinstallExecEnv({ ...process.env, OFFICECLI_REPO: repo }),
        });
    } catch (e: unknown) {
        const status = asRecord(e)["status"];
        if (OFFICECLI_REQUIRE) {
            throw new Error(`OfficeCLI install required but failed (exit ${fieldString(status, '?')})`);
        }
        console.warn(`[jaw:init] ⚠️  officecli install failed (exit ${fieldString(status, '?')}); skipping — run manually: bash scripts/install-officecli.sh`);
    }
}

const CLI_PACKAGES: { bin: string; pkg: string; brew?: string; forceMgr?: PkgMgr }[] = [
    { bin: 'claude', pkg: '@anthropic-ai/claude-code' },
    { bin: 'codex', pkg: '@openai/codex', forceMgr: 'npm' },
    { bin: 'gemini', pkg: '@google/gemini-cli', forceMgr: 'npm' },
    { bin: 'copilot', pkg: '@github/copilot', forceMgr: 'npm' },
    { bin: 'opencode', pkg: 'opencode-ai', forceMgr: 'npm' },
];

type PkgMgr = 'bun' | 'npm' | 'brew';

function truthyEnv(value: string | undefined): boolean {
    return value === '1' || value?.toLowerCase() === 'true';
}

export function shouldInstallCliToolsDuringPostinstall(env: NodeJS.ProcessEnv = process.env): boolean {
    return truthyEnv(env["CLI_JAW_INSTALL_CLI_TOOLS"]) || truthyEnv(env["npm_config_jaw_install_cli_tools"]);
}

export function shouldRequireOfficeCliDuringPostinstall(env: NodeJS.ProcessEnv = process.env): boolean {
    return truthyEnv(env["CLI_JAW_REQUIRE_OFFICECLI"]) || truthyEnv(env["npm_config_jaw_require_officecli"]);
}

export function shouldRequireCliToolsDuringPostinstall(env: NodeJS.ProcessEnv = process.env): boolean {
    return truthyEnv(env["CLI_JAW_REQUIRE_CLI_TOOLS"]) || truthyEnv(env["npm_config_jaw_require_cli_tools"]);
}

export function shouldInstallClaudeDuringPostinstall(env: NodeJS.ProcessEnv = process.env): boolean {
    return !truthyEnv(env["CLI_JAW_SKIP_CLAUDE"]) && !truthyEnv(env["npm_config_jaw_skip_claude"]);
}

export function shouldForceClaudeDuringPostinstall(env: NodeJS.ProcessEnv = process.env): boolean {
    return truthyEnv(env["CLI_JAW_FORCE_CLAUDE"]) || truthyEnv(env["npm_config_jaw_force_claude"]);
}

export function shouldDedupeCliTools(env: NodeJS.ProcessEnv = process.env): boolean {
    return truthyEnv(env["CLI_JAW_DEDUPE_CLI_TOOLS"]) || truthyEnv(env["npm_config_jaw_dedupe_cli_tools"]);
}

function shouldMigrateLegacyHome(env: NodeJS.ProcessEnv = process.env): boolean {
    return truthyEnv(env["CLI_JAW_MIGRATE_LEGACY_HOME"]) || truthyEnv(env["npm_config_jaw_migrate_legacy_home"]);
}

function npmPrefixGlobal(): string | null {
    try {
        return execFileSync('npm', ['prefix', '-g'], {
            encoding: 'utf8',
            stdio: 'pipe',
            timeout: 3000,
            env: postinstallExecEnv(),
        }).trim();
    } catch {
        return null;
    }
}

function pathHasSegment(candidate: string, segment: string): boolean {
    return candidate.split(path.sep).includes(segment);
}

export function classifyInstallerFromPath(
    binPath: string,
    options: { binName?: string; npmPrefix?: string | null; realPath?: string | null } = {},
): PkgMgr | null {
    const cleanBinPath = path.normalize(binPath);
    const realPath = path.normalize(options.realPath || binPath);
    const npmPrefix = options.npmPrefix ? path.normalize(options.npmPrefix) : '';
    const binName = options.binName || path.basename(cleanBinPath);

    if (pathHasSegment(cleanBinPath, '.bun') || pathHasSegment(realPath, '.bun')) return 'bun';
    if (pathHasSegment(realPath, 'Cellar')) return 'brew';

    if (npmPrefix) {
        const npmBin = path.join(npmPrefix, 'bin');
        const npmModules = path.join(npmPrefix, 'lib', 'node_modules');
        if (
            cleanBinPath === path.join(npmBin, binName)
            || cleanBinPath.startsWith(`${npmBin}${path.sep}`)
            || realPath.startsWith(`${npmModules}${path.sep}`)
            || realPath === path.join(npmModules, binName)
        ) {
            return 'npm';
        }
    }

    if (pathHasSegment(cleanBinPath, '.nvm') || pathHasSegment(realPath, '.nvm')) return 'npm';
    if (pathHasSegment(cleanBinPath, 'nodejs') || pathHasSegment(realPath, 'nodejs')) return 'npm';
    return null;
}

/** Detect which package manager originally installed a binary. */
export function detectInstaller(binName: string): PkgMgr | null {
    const binPath = findBinaryPath(binName);
    if (!binPath) return null;
    let realPath: string | null = null;
    try {
        realPath = fs.realpathSync(binPath);
    } catch {
        realPath = null;
    }
    return classifyInstallerFromPath(binPath, {
        binName,
        npmPrefix: npmPrefixGlobal(),
        realPath,
    });
}

/** Detect the default package manager for fresh installs. */
function detectDefaultPkgMgr(): Exclude<PkgMgr, 'brew'> {
    try { execSync('bun --version', { stdio: 'pipe', env: postinstallExecEnv() }); return 'bun'; } catch { return 'npm'; }
}

function buildInstallCmd(mgr: PkgMgr, pkg: string, brewFormula?: string): string {
    switch (mgr) {
        case 'brew': return `brew upgrade ${brewFormula || pkg} 2>/dev/null || brew install ${brewFormula || pkg}`;
        case 'bun':  return `bun install -g ${pkg}@latest`;
        case 'npm':  return `npm i -g ${pkg}@latest`;
    }
}

function buildClaudeNativeInstallCmd(): string {
    if (process.platform === 'win32') {
        return `powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression (Invoke-RestMethod '${CLAUDE_NATIVE_INSTALL_PS_URL}')"`;
    }
    return `curl -fsSL ${CLAUDE_NATIVE_INSTALL_URL} | bash`;
}

function runClaudeNativeInstall(cmd: string): void {
    const env = postinstallExecEnv();
    if (process.platform === 'win32') {
        execFileSync('powershell', [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            `Invoke-Expression (Invoke-RestMethod '${CLAUDE_NATIVE_INSTALL_PS_URL}')`,
        ], {
            stdio: 'pipe',
            timeout: 180000,
            env,
        });
        return;
    }
    execSync(cmd, {
        stdio: 'pipe',
        timeout: 180000,
        env,
    });
}

function findClaudeNativeBinary(): string | null {
    const candidates = [
        path.join(home, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
        path.join(home, '.local', 'bin', 'claude'),
        path.join(home, '.claude', 'local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
        path.join(home, '.claude', 'local', 'bin', 'claude'),
        findBinaryPath('claude'),
    ].filter((candidate): candidate is string => !!candidate);

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        if (process.platform !== 'win32' && !isSpawnableCliFile(candidate, process.platform).ok) continue;
        try {
            const realPath = fs.realpathSync(candidate);
            if (classifyClaudeInstall(candidate) === 'native' || classifyClaudeInstall(realPath) === 'native') {
                return candidate;
            }
        } catch {
            if (classifyClaudeInstall(candidate) === 'native') return candidate;
        }
    }
    return null;
}

function findExistingClaudeBinary(): string | null {
    const detected = detectCliBinary('claude', process.env["PATH"] || '');
    return detected.available ? detected.path : null;
}

function installClaudeCli(options: { force?: boolean } = {}): boolean {
    const existingPath = findExistingClaudeBinary();
    if (existingPath && !options.force) {
        console.log(`[jaw:init] ⏭️  claude already present → ${existingPath}`);
        return true;
    }

    const cmd = buildClaudeNativeInstallCmd();
    const label = process.platform === 'win32' ? 'native PowerShell installer' : 'native installer';
    console.log(`[jaw:init] 📦 claude (${label}): ${cmd}`);
    try {
        runClaudeNativeInstall(cmd);
    } catch (e: unknown) {
        console.error(`[jaw:init] ⚠️  claude: auto-install failed — install manually: ${cmd}`);
        const message = errString(e);
        if (message) console.error(`             ${message.slice(0, 160)}`);
        return false;
    }

    const nativePath = findClaudeNativeBinary();
    if (nativePath) {
        console.log(`[jaw:init] ✅ claude native binary → ${nativePath}`);
        return true;
    }

    console.error('[jaw:init] ⚠️  claude: installer completed but native binary was not found');
    console.error('[jaw:init]    expected ~/.local/bin/claude, ~/.claude/local/bin/claude, or %USERPROFILE%\\.local\\bin\\claude.exe');
    return false;
}

/** Check if a package is installed via a specific manager (independent of PATH order). */
function isInstalledVia(mgr: PkgMgr, pkg: string, brewFormula?: string): boolean {
    try {
        switch (mgr) {
            case 'npm':
                execSync(`npm ls -g ${pkg} --depth=0`, { stdio: 'pipe', timeout: 5000, env: postinstallExecEnv() });
                return true;
            case 'bun': {
                const bunGlobal = path.join(home, '.bun', 'install', 'global', 'node_modules', pkg.split('/').pop()!);
                return fs.existsSync(bunGlobal);
            }
            case 'brew':
                execSync(`brew list --formula ${brewFormula || pkg}`, { stdio: 'pipe', timeout: 5000, env: postinstallExecEnv() });
                return true;
        }
    } catch { return false; }
}

function buildUninstallCmd(mgr: PkgMgr, pkg: string, brewFormula?: string): string {
    switch (mgr) {
        case 'npm':  return `npm uninstall -g ${pkg}`;
        case 'bun':  return `bun remove -g ${pkg}`;
        case 'brew': return `brew uninstall ${brewFormula || pkg}`;
    }
}

/** Remove duplicate installations — keep the preferred manager when postinstall just installed one. */
function deduplicateCliTool(bin: string, pkg: string, brew?: string, preferredActive?: PkgMgr): void {
    const detectedActive = detectInstaller(bin);
    const active = preferredActive && isInstalledVia(preferredActive, pkg, brew)
        ? preferredActive
        : detectedActive;
    if (!active) return; // not installed at all
    const others: PkgMgr[] = (['bun', 'npm', 'brew'] as const).filter(m => m !== active);
    const duplicates = others.filter(mgr => isInstalledVia(mgr, pkg, brew));
    if (!duplicates.length) return;
    if (!shouldDedupeCliTools()) {
        console.log(`[jaw:init] ℹ️  ${bin}: duplicate install(s) detected via ${duplicates.join(', ')}; not removing automatically`);
        console.log('[jaw:init]    set CLI_JAW_DEDUPE_CLI_TOOLS=1 to allow automatic duplicate removal');
        return;
    }
    for (const mgr of duplicates) {
        const cmd = buildUninstallCmd(mgr, pkg, brew);
        console.log(`[jaw:init] 🧹 ${bin}: removing duplicate from ${mgr} (active: ${active})`);
        try {
            execSync(cmd, { stdio: 'pipe', timeout: 30000, env: postinstallExecEnv() });
            console.log(`[jaw:init]    removed ${pkg} from ${mgr}`);
        } catch {
            console.warn(`[jaw:init]    ⚠️  failed to remove ${pkg} from ${mgr} — remove manually: ${cmd}`);
        }
    }
}

export async function installCliTools(opts: InstallOpts = {}) {
    const defaultMgr = detectDefaultPkgMgr();
    const failed: string[] = [];

    console.log('[jaw:init] installing CLI tools @latest...');
    for (const { bin, pkg, brew, forceMgr } of CLI_PACKAGES) {
        if (bin === 'claude') {
            if (opts.dryRun) { console.log(`  [dry-run] would run ${buildClaudeNativeInstallCmd()}`); continue; }
            if (opts.interactive && opts.ask) {
                const answer = await opts.ask('Install claude (native Claude Code installer)? [y/N]', 'n');
                if (answer.toLowerCase() !== 'y') { console.log(`  ⏭️  skipped ${bin}`); continue; }
            }
            if (!installClaudeCli({ force: shouldForceClaudeDuringPostinstall() })) failed.push('claude (native installer)');
            continue;
        }
        if (opts.dryRun) {
            const dryRunMgr = forceMgr || 'npm';
            console.log(`  [dry-run] would run ${buildInstallCmd(dryRunMgr, pkg, brew)}`);
            continue;
        }
        if (opts.interactive && opts.ask) {
            const answer = await opts.ask(`Install ${bin} (${pkg})? [y/N]`, 'n');
            if (answer.toLowerCase() !== 'y') { console.log(`  ⏭️  skipped ${bin}`); continue; }
        }
        // forceMgr overrides detection (e.g. copilot → always npm)
        const existing = forceMgr ? null : detectInstaller(bin);
        const mgr = forceMgr || existing || defaultMgr;
        const cmd = buildInstallCmd(mgr, pkg, brew);
        const tag = existing ? `update via ${mgr}` : `fresh install via ${mgr}`;
        console.log(`[jaw:init] 📦 ${bin} (${tag}): ${cmd}`);
        try {
            execSync(cmd, { stdio: 'pipe', timeout: 180000, env: postinstallExecEnv() });
            console.log(`[jaw:init] ✅ ${bin} installed`);
        } catch {
            // Fallback: if preferred manager failed and it wasn't npm, try npm
            if (mgr !== 'npm') {
                console.log(`[jaw:init] ⚠️  ${mgr} failed, trying npm i -g ${pkg}@latest ...`);
                try {
                    execSync(`npm i -g ${pkg}@latest`, { stdio: 'pipe', timeout: 180000, env: postinstallExecEnv() });
                    console.log(`[jaw:init] ✅ ${bin} installed (via npm fallback)`);
                } catch {
                    failed.push(`${bin} (${pkg})`);
                    console.error(`[jaw:init] ⚠️  ${bin}: auto-install failed — install manually: npm i -g ${pkg}`);
                }
            } else {
                failed.push(`${bin} (${pkg})`);
                console.error(`[jaw:init] ⚠️  ${bin}: auto-install failed — install manually: npm i -g ${pkg}`);
            }
        }
        // Clean up duplicate installations from other package managers
        deduplicateCliTool(bin, pkg, brew, forceMgr);
    }

    if (failed.length > 0 && shouldRequireCliToolsDuringPostinstall()) {
        throw new Error(`Required CLI tool install failed: ${failed.join(', ')}`);
    }
}

const MCP_PACKAGES = [
    { name: 'context7', pkg: '@upstash/context7-mcp', bin: 'context7-mcp' },
];

export async function installMcpServers(opts: InstallOpts = {}) {
    console.log('[jaw:init] installing MCP servers globally...');
    const config = loadUnifiedMcp();
    let updated = false;

    const servers = asRecord(config.servers);

    for (const { name, pkg, bin } of MCP_PACKAGES) {
        try {
            const server = asRecord(servers[name]);
            if (typeof server["url"] === 'string' && server["url"]) {
                console.log(`[jaw:init] ⏭️  ${name} MCP (remote URL, no local install needed)`);
                continue;
            }

            const installedPath = findBinaryPath(bin);
            if (installedPath) {
                console.log(`[jaw:init] ⏭️  ${bin} (already installed)`);
                continue;
            }
            if (opts.dryRun) { console.log(`  [dry-run] would install ${pkg}`); continue; }
            if (opts.interactive && opts.ask) {
                const answer = await opts.ask(`Install MCP server ${bin} (${pkg})? [y/N]`, 'n');
                if (answer.toLowerCase() !== 'y') { console.log(`  ⏭️  skipped ${bin}`); continue; }
            }

            console.log(`[jaw:init] 📦 npm i -g ${pkg} ...`);
            execSync(`npm i -g ${pkg}`, { stdio: 'pipe', timeout: 120000, env: postinstallExecEnv() });

            const binPath = findBinaryPath(bin) || bin;
            console.log(`[jaw:init] ✅ ${bin} → ${binPath}`);

            for (const srv of Object.values(servers).map(asRecord)) {
                const args = asArray(srv["args"]);
                if (srv["command"] === 'npx' && args.includes(pkg)) {
                    srv["command"] = bin;
                    srv["args"] = [];
                    updated = true;
                }
            }
        } catch (e) {
            console.error(`[jaw:init] ⚠️  ${pkg}: ${(e as Error).message?.slice(0, 80)}`);
        }
    }

    if (updated) saveUnifiedMcp(config);
}

const SKILL_DEPS = [
    {
        name: 'uv',
        check: 'uv --version',
        install: process.platform === 'win32'
            ? 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'
            : 'curl -LsSf https://astral.sh/uv/install.sh | sh',
        why: 'Python skills (imagegen, pdf, speech, spreadsheet, transcribe)',
    },
    {
        name: 'playwright-core',
        check: 'node -e "require.resolve(\'playwright-core\')"',
        install: 'npm i -g playwright-core',
        why: 'Browser control skill (cli-jaw browser)',
    },
];

export async function installSkillDeps(opts: InstallOpts = {}) {
    console.log('[jaw:init] checking skill dependencies...');
    for (const dep of SKILL_DEPS) {
        try {
            execSync(dep.check, { stdio: 'pipe', timeout: 10000, env: postinstallExecEnv() });
            console.log(`[jaw:init] ⏭️  ${dep.name} (already installed)`);
        } catch {
            if (opts.dryRun) { console.log(`  [dry-run] would install ${dep.name} (${dep.why})`); continue; }
            if (opts.interactive && opts.ask) {
                const answer = await opts.ask(`Install ${dep.name} (${dep.why})? [y/N]`, 'n');
                if (answer.toLowerCase() !== 'y') { console.log(`  ⏭️  skipped ${dep.name}`); continue; }
            }
            console.log(`[jaw:init] 📦 installing ${dep.name} (${dep.why})...`);
            try {
                execSync(dep.install, { stdio: 'pipe', timeout: 120000, env: postinstallExecEnv() });
                console.log(`[jaw:init] ✅ ${dep.name} installed`);
            } catch (e) {
                console.error(`[jaw:init] ⚠️  ${dep.name}: auto-install failed — install manually:`);
                console.error(`             ${dep.install}`);
            }
        }
    }
}

// ─── runPostinstall: setup + install (no top-level side effects) ────
// Called only when running as npm postinstall entry point.
// Dynamic import from init.ts gets clean library exports only.
export async function runPostinstall() {
    // ── Safe mode guard (before ANY side effects) ──
    const isSafeMode = process.env["npm_config_jaw_safe"] === '1'
        || process.env["npm_config_jaw_safe"] === 'true'
        || process.env["JAW_SAFE"] === '1'
        || process.env["JAW_SAFE"] === 'true';

    if (isSafeMode) {
        ensureDir(jawHome);
        console.log('[jaw:postinstall] 🔒 safe mode — home directory created only');
        console.log('[jaw:postinstall] Run `jaw init` to configure interactively');
        return;
    }

    // ── Legacy migration (only in normal mode, NOT safe mode) ──
    const legacyHome = path.join(home, '.cli-jaw');
    const isCustomHome = jawHome !== legacyHome;
    if (isCustomHome && fs.existsSync(legacyHome)) {
        if (fs.existsSync(jawHome)) {
            console.log(`[jaw:init] ⚠️ both ~/.cli-jaw and ${jawHome} exist — using ${jawHome}`);
        } else if (shouldMigrateLegacyHome()) {
            console.log(`[jaw:init] migrating ~/.cli-jaw → ${jawHome} ...`);
            fs.renameSync(legacyHome, jawHome);
            console.log(`[jaw:init] ✅ migration complete`);
        } else {
            console.log(`[jaw:init] legacy ~/.cli-jaw detected; not migrating to ${jawHome} automatically`);
            console.log('[jaw:init] to opt in: CLI_JAW_MIGRATE_LEGACY_HOME=1 npm install -g cli-jaw');
        }
    }

    // 1. Ensure ~/.cli-jaw/ home directory
    ensureDir(jawHome);

    // 2. Ensure sub-directories (only in normal mode)
    ensureDir(path.join(jawHome, 'skills'));
    ensureDir(path.join(jawHome, 'uploads'));

    // 2. Skills symlinks — isolated-by-default (Issue #58)
    // No workingDir compat links in postinstall.
    // Postinstall must remain isolated to ~/.cli-jaw/* only.
    const shouldMigrateSharedPaths =
        process.env["CLI_JAW_MIGRATE_SHARED_PATHS"] === '1'
        || process.env["CLI_JAW_MIGRATE_SHARED_PATHS"] === 'true'
        || process.env["npm_config_jaw_migrate_shared_paths"] === '1'
        || process.env["npm_config_jaw_migrate_shared_paths"] === 'true';

    if (shouldMigrateSharedPaths) {
        const sharedReport = ensureSharedHomeSkillsLinks({
            onConflict: 'backup',
            includeAgents: true,
            includeCompatAgent: true,
            includeClaude: true,
        });
        logSkillsSymlinkReport(sharedReport);
    } else {
        console.log('[jaw:init] shared path migration skipped (isolated-by-default)');
        console.log('[jaw:init] to opt in: CLI_JAW_MIGRATE_SHARED_PATHS=1 npm install -g cli-jaw');
    }

    // 3. CLAUDE.md → AGENTS.md symlink
    const agentsMd = path.join(jawHome, 'AGENTS.md');
    const claudeMd = path.join(jawHome, 'CLAUDE.md');
    if (fs.existsSync(agentsMd) && !fs.existsSync(claudeMd)) {
        ensureSymlink(agentsMd, claudeMd);
    }

    // 4. Default heartbeat.json
    const heartbeatPath = path.join(jawHome, 'heartbeat.json');
    if (!fs.existsSync(heartbeatPath)) {
        fs.writeFileSync(heartbeatPath, JSON.stringify({ jobs: [] }, null, 2));
        console.log(`[jaw:init] created ${heartbeatPath}`);
    }

    // 5. MCP config
    initMcpConfig(home);

    // 6. Default skills (base) + propagate to all instances
    copyDefaultSkills();
    propagateSkillsToInstances();

    // 7-9. Install MCP servers, skill deps, officecli runtime. Claude is the default
    // agent CLI, so keep it spawnable; other agent CLIs remain opt-in.
    if (shouldInstallCliToolsDuringPostinstall()) {
        await installCliTools();
    } else {
        if (shouldInstallClaudeDuringPostinstall()) {
            const ok = installClaudeCli({ force: shouldForceClaudeDuringPostinstall() });
            if (!ok && shouldRequireCliToolsDuringPostinstall()) {
                throw new Error('Required CLI tool install failed: claude (native installer)');
            }
        } else {
            console.log('[jaw:init] claude install skipped (CLI_JAW_SKIP_CLAUDE)');
        }
        console.log('[jaw:init] additional CLI tool install/update skipped by default');
        console.log('[jaw:init] to opt in: CLI_JAW_INSTALL_CLI_TOOLS=1 npm install -g cli-jaw');
    }
    await installMcpServers();
    await installSkillDeps();
    await installOfficeCli();
    await maybeReregisterLaunchd();
    console.log('[jaw:init] setup complete ✅');
}

// Auto-run only when executed as CLI entry point (not imported)
const isEntryPoint = process.argv[1]?.endsWith('postinstall.js')
    || process.argv[1]?.endsWith('postinstall.ts');
if (isEntryPoint) {
    runPostinstall().catch(e => { console.error(e); process.exit(1); });
}

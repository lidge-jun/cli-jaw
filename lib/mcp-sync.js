/**
 * lib/mcp-sync.js — Phase 12.1
 * Unified MCP config → CLI-specific format conversion.
 * Source of truth: ~/.cli-claw/mcp.json
 *
 * Supported targets:
 *   Claude Code  → {workingDir}/.mcp.json        (JSON, mcpServers)
 *   Codex        → ~/.codex/config.toml           (TOML, [mcp_servers.name])
 *   Gemini CLI   → ~/.gemini/settings.json        (JSON, mcpServers)
 *   OpenCode     → ~/.config/opencode/opencode.json (JSON, mcp block)
 */
import fs from 'fs';
import os from 'os';
import { join, dirname } from 'path';

const CLAW_HOME = join(os.homedir(), '.cli-claw');
const MCP_PATH = join(CLAW_HOME, 'mcp.json');

// ─── Load / Save unified config ────────────────────

export function loadUnifiedMcp() {
    try {
        return JSON.parse(fs.readFileSync(MCP_PATH, 'utf8'));
    } catch {
        return { servers: {} };
    }
}

export function saveUnifiedMcp(config) {
    fs.mkdirSync(CLAW_HOME, { recursive: true });
    fs.writeFileSync(MCP_PATH, JSON.stringify(config, null, 4) + '\n');
}

// ─── Import from existing configs ──────────────────

/** Import from Claude-style .mcp.json into unified format */
export function importFromClaudeMcp(filePath) {
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const servers = {};
        for (const [name, srv] of Object.entries(raw.mcpServers || {})) {
            servers[name] = {
                command: srv.command,
                args: srv.args || [],
                ...(srv.env && Object.keys(srv.env).length ? { env: srv.env } : {}),
            };
        }
        return { servers };
    } catch { return { servers: {} }; }
}

// ─── Convert to CLI-specific formats ───────────────

/** → Claude Code / Gemini CLI format (.mcp.json / settings.json mcpServers block) */
export function toClaudeMcp(config) {
    const mcpServers = {};
    for (const [name, srv] of Object.entries(config.servers || {})) {
        mcpServers[name] = { command: srv.command, args: srv.args || [] };
        if (srv.env && Object.keys(srv.env).length) mcpServers[name].env = srv.env;
    }
    return { mcpServers };
}

/** → Codex config.toml MCP section string */
export function toCodexToml(config) {
    let toml = '';
    for (const [name, srv] of Object.entries(config.servers || {})) {
        toml += `[mcp_servers.${name}]\n`;
        toml += `command = "${srv.command}"\n`;
        toml += `args = ${JSON.stringify(srv.args || [])}\n`;
        if (srv.env && Object.keys(srv.env).length) {
            toml += `[mcp_servers.${name}.env]\n`;
            for (const [k, v] of Object.entries(srv.env)) {
                toml += `${k} = "${v}"\n`;
            }
        }
        toml += '\n';
    }
    return toml;
}

/** → OpenCode opencode.json mcp block */
export function toOpenCodeMcp(config) {
    const mcp = {};
    for (const [name, srv] of Object.entries(config.servers || {})) {
        mcp[name] = {
            type: 'local',
            command: [srv.command, ...(srv.args || [])],
        };
        if (srv.env && Object.keys(srv.env).length) mcp[name].environment = srv.env;
    }
    return mcp;
}

// ─── Patch helpers ─────────────────────────────────

/** Replace only [mcp_servers.*] sections in existing TOML, keep everything else */
export function patchCodexToml(existingToml, newMcpToml) {
    const lines = existingToml.split('\n');
    const output = [];
    let inMcp = false;

    for (const line of lines) {
        if (/^\[mcp_servers\./.test(line)) {
            inMcp = true;
            continue;
        }
        if (inMcp && /^\[/.test(line) && !/^\[mcp_servers\./.test(line)) {
            inMcp = false;
        }
        if (!inMcp) output.push(line);
    }

    // Remove trailing blank lines before appending MCP section
    while (output.length && output[output.length - 1].trim() === '') output.pop();
    return output.join('\n') + '\n\n' + newMcpToml;
}

/** Patch JSON file — merge a block into existing JSON without losing other keys */
function patchJsonFile(filePath, patchObj) {
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { }
    const merged = { ...existing, ...patchObj };
    fs.mkdirSync(dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 4) + '\n');
}

// ─── Sync to all targets ──────────────────────────

/**
 * Sync unified MCP config to all CLI config files.
 * @param {Object} config - Unified MCP config { servers: {...} }
 * @param {string} workingDir - Current working directory for project-scoped files
 */
export function syncToAll(config, workingDir) {
    const results = { claude: false, codex: false, gemini: false, opencode: false };

    // 1. Claude Code: {workingDir}/.mcp.json
    try {
        const claudePath = join(workingDir, '.mcp.json');
        const claudeData = toClaudeMcp(config);
        // Merge with existing (keep other keys if any)
        let existing = {};
        try { existing = JSON.parse(fs.readFileSync(claudePath, 'utf8')); } catch { }
        existing.mcpServers = claudeData.mcpServers;
        fs.writeFileSync(claudePath, JSON.stringify(existing, null, 4) + '\n');
        results.claude = true;
        console.log(`[mcp-sync] ✅ Claude: ${claudePath}`);
    } catch (e) { console.error(`[mcp-sync] ❌ Claude:`, e.message); }

    // 2. Codex: ~/.codex/config.toml
    try {
        const codexPath = join(os.homedir(), '.codex', 'config.toml');
        if (fs.existsSync(codexPath)) {
            const existing = fs.readFileSync(codexPath, 'utf8');
            const mcpToml = toCodexToml(config);
            fs.writeFileSync(codexPath, patchCodexToml(existing, mcpToml));
            results.codex = true;
            console.log(`[mcp-sync] ✅ Codex: ${codexPath}`);
        } else {
            console.log(`[mcp-sync] ⏭️ Codex: config.toml not found, skipping`);
        }
    } catch (e) { console.error(`[mcp-sync] ❌ Codex:`, e.message); }

    // 3. Gemini CLI: ~/.gemini/settings.json
    try {
        const geminiPath = join(os.homedir(), '.gemini', 'settings.json');
        if (fs.existsSync(geminiPath)) {
            const geminiData = toClaudeMcp(config);
            patchJsonFile(geminiPath, { mcpServers: geminiData.mcpServers });
            results.gemini = true;
            console.log(`[mcp-sync] ✅ Gemini: ${geminiPath}`);
        } else {
            console.log(`[mcp-sync] ⏭️ Gemini: settings.json not found, skipping`);
        }
    } catch (e) { console.error(`[mcp-sync] ❌ Gemini:`, e.message); }

    // 4. OpenCode: ~/.config/opencode/opencode.json
    try {
        const opencodePath = join(os.homedir(), '.config', 'opencode', 'opencode.json');
        if (fs.existsSync(opencodePath)) {
            const ocMcp = toOpenCodeMcp(config);
            patchJsonFile(opencodePath, { mcp: ocMcp });
            results.opencode = true;
            console.log(`[mcp-sync] ✅ OpenCode: ${opencodePath}`);
        } else {
            console.log(`[mcp-sync] ⏭️ OpenCode: opencode.json not found, skipping`);
        }
    } catch (e) { console.error(`[mcp-sync] ❌ OpenCode:`, e.message); }

    return results;
}

// ─── Skills symlink helper ─────────────────────────

/**
 * Ensure {workingDir}/.agents/skills → ~/.cli-claw/skills
 * Also ensure ~/.agent/skills → ~/.agents/skills (compat)
 */
export function ensureSkillsSymlinks(workingDir) {
    const skillsSource = join(CLAW_HOME, 'skills');
    fs.mkdirSync(skillsSource, { recursive: true });

    // 1. {workingDir}/.agents/skills → ~/.cli-claw/skills
    const wdLink = join(workingDir, '.agents', 'skills');
    if (!fs.existsSync(wdLink)) {
        fs.mkdirSync(dirname(wdLink), { recursive: true });
        fs.symlinkSync(skillsSource, wdLink);
        console.log(`[skills] symlink: ${wdLink} → ${skillsSource}`);
    }

    // 2. Home fallback: ~/.agents/skills (if different from workingDir)
    const homeLink = join(os.homedir(), '.agents', 'skills');
    if (homeLink !== wdLink && !fs.existsSync(homeLink)) {
        fs.mkdirSync(dirname(homeLink), { recursive: true });
        fs.symlinkSync(skillsSource, homeLink);
        console.log(`[skills] symlink: ${homeLink} → ${skillsSource}`);
    }

    // 3. Compat: ~/.agent/skills → ~/.agents/skills
    const compatLink = join(os.homedir(), '.agent', 'skills');
    if (!fs.existsSync(compatLink)) {
        fs.mkdirSync(dirname(compatLink), { recursive: true });
        fs.symlinkSync(homeLink, compatLink);
        console.log(`[skills] symlink: ${compatLink} → ${homeLink}`);
    }
}

// ─── Default MCP servers ───────────────────────────

const DEFAULT_MCP_SERVERS = {
    puppeteer: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-puppeteer'],
        env: { PUPPETEER_HEADLESS: 'false' },
    },
    context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp'],
    },
};

// Phase 12.1.3: npx package → global binary mapping
const NPX_TO_GLOBAL = {
    '@modelcontextprotocol/server-puppeteer': { pkg: '@modelcontextprotocol/server-puppeteer', bin: 'mcp-server-puppeteer' },
    '@upstash/context7-mcp': { pkg: '@upstash/context7-mcp', bin: 'context7-mcp' },
};

function resolveNpxPackage(args) {
    const pkg = (args || []).find(a => !a.startsWith('-'));
    return pkg ? NPX_TO_GLOBAL[pkg] : null;
}

/**
 * Phase 12.1.3: Install MCP servers globally.
 * npx-based → npm i -g, uv-based → uv tool install.
 * Returns per-server results.
 */
export async function installMcpServers(config) {
    const { execSync } = await import('child_process');
    const results = {};

    for (const [name, srv] of Object.entries(config.servers || {})) {
        // Skip already-global servers
        if (srv.command !== 'npx' && srv.command !== 'uv' && srv.command !== 'uvx') {
            results[name] = { status: 'skip', reason: 'already global' };
            continue;
        }

        try {
            if (srv.command === 'npx') {
                // npm ecosystem
                const info = resolveNpxPackage(srv.args);
                if (!info) { results[name] = { status: 'skip', reason: 'unknown npm pkg' }; continue; }

                console.log(`[mcp:install] npm i -g ${info.pkg} ...`);
                execSync(`npm i -g ${info.pkg}`, { stdio: 'pipe', timeout: 120000 });

                let binPath;
                try { binPath = execSync(`which ${info.bin}`, { encoding: 'utf8' }).trim(); }
                catch { binPath = info.bin; }

                srv.command = info.bin;
                srv.args = [];
                results[name] = { status: 'installed', bin: binPath, eco: 'npm' };
                console.log(`[mcp:install] ✅ ${name} → ${binPath}`);

            } else {
                // uv/uvx ecosystem (pypi)
                const pkg = (srv.args || []).find(a => !a.startsWith('-') && !a.startsWith('/'));
                if (!pkg) { results[name] = { status: 'skip', reason: 'no pypi pkg found' }; continue; }

                console.log(`[mcp:install] uv tool install ${pkg} ...`);
                try {
                    execSync(`uv tool install ${pkg}`, { stdio: 'pipe', timeout: 120000 });
                } catch {
                    try { execSync(`uv tool upgrade ${pkg}`, { stdio: 'pipe', timeout: 120000 }); }
                    catch { /* already latest */ }
                }

                let binPath;
                try { binPath = execSync(`which ${pkg}`, { encoding: 'utf8' }).trim(); }
                catch { binPath = pkg; }

                srv.command = binPath || pkg;
                srv.args = [];
                results[name] = { status: 'installed', bin: binPath, eco: 'pypi' };
                console.log(`[mcp:install] ✅ ${name} → ${binPath}`);
            }
        } catch (e) {
            results[name] = { status: 'error', message: e.message?.slice(0, 200) };
            console.error(`[mcp:install] ❌ ${name}: ${e.message?.slice(0, 100)}`);
        }
    }

    return results;
}

// ─── Init: first-time setup ────────────────────────

/**
 * Initialize MCP config if missing.
 * If workingDir has .mcp.json, import and merge with defaults.
 * Otherwise, create config with default servers (puppeteer, context7).
 */
export function initMcpConfig(workingDir) {
    if (fs.existsSync(MCP_PATH)) {
        console.log(`[mcp-sync] unified config exists: ${MCP_PATH}`);
        return loadUnifiedMcp();
    }

    let servers = { ...DEFAULT_MCP_SERVERS };

    // Try importing from existing .mcp.json, merge with defaults
    const claudePath = join(workingDir, '.mcp.json');
    if (fs.existsSync(claudePath)) {
        console.log(`[mcp-sync] importing from ${claudePath}`);
        const imported = importFromClaudeMcp(claudePath);
        servers = { ...servers, ...(imported.servers || {}) };
    }

    const config = { servers };
    saveUnifiedMcp(config);
    console.log(`[mcp-sync] initialized with ${Object.keys(servers).length} servers: ${Object.keys(servers).join(', ')}`);
    return config;
}

// ─── Skills: copy defaults from Codex ──────────────

/**
 * Copy default skills from ~/.codex/skills/ to ~/.cli-claw/skills/
 * Only copies skills that don't already exist in target.
 * Also checks ~/.claude/commands/ for Claude Code slash commands.
 */
export function copyDefaultSkills() {
    const targetDir = join(CLAW_HOME, 'skills');
    fs.mkdirSync(targetDir, { recursive: true });

    let copied = 0;

    // 1. Copy from Codex skills (~/.codex/skills/)
    const codexSkills = join(os.homedir(), '.codex', 'skills');
    if (fs.existsSync(codexSkills)) {
        const skills = fs.readdirSync(codexSkills, { withFileTypes: true })
            .filter(d => d.isDirectory());
        for (const skill of skills) {
            const src = join(codexSkills, skill.name);
            const dst = join(targetDir, skill.name);
            if (!fs.existsSync(dst)) {
                copyDirRecursive(src, dst);
                copied++;
            }
        }
        console.log(`[skills] copied ${copied} Codex skills → ${targetDir}`);
    }

    return copied;
}

/** Recursively copy a directory */
function copyDirRecursive(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = join(src, entry.name);
        const dstPath = join(dst, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, dstPath);
        } else {
            fs.copyFileSync(srcPath, dstPath);
        }
    }
}


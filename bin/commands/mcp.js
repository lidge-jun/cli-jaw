/**
 * cli-claw mcp — Phase 12.1.3.1
 * MCP server management: list, install, sync.
 *
 * Usage:
 *   cli-claw mcp                       # list servers
 *   cli-claw mcp install <pkg>         # install npm/pypi package + add to mcp.json + sync
 *   cli-claw mcp sync                  # sync mcp.json → 4 CLI configs
 *
 * Package detection:
 *   npm:  @scope/name or name          → npm i -g <pkg>
 *   pypi: name (with --pypi flag)      → uv tool install <pkg> / pip install <pkg>
 *         or auto-detect by known prefixes (mcp-server-*)
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CLAW_HOME = join(homedir(), '.cli-claw');
const MCP_PATH = join(CLAW_HOME, 'mcp.json');

// ─── ANSI ────────────────────────────────────
const c = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    cyan: '\x1b[36m',
};

// ─── Helpers ─────────────────────────────────
function loadMcp() {
    try { return JSON.parse(readFileSync(MCP_PATH, 'utf8')); }
    catch { return { servers: {} }; }
}

function saveMcp(config) {
    mkdirSync(CLAW_HOME, { recursive: true });
    writeFileSync(MCP_PATH, JSON.stringify(config, null, 4) + '\n');
}

function exec(cmd) {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', timeout: 120000 }).trim();
}

// Known PyPI MCP packages (auto-detect without --pypi flag)
const PYPI_PATTERNS = [
    /^mcp-server-/,       // mcp-server-fetch, mcp-server-git, etc.
    /^mcp-/,
];

function detectEcosystem(pkg, forceFlag) {
    if (forceFlag === 'pypi') return 'pypi';
    if (forceFlag === 'npm') return 'npm';
    // Auto-detect
    if (pkg.startsWith('@')) return 'npm';  // @scope/name → npm
    if (PYPI_PATTERNS.some(p => p.test(pkg))) return 'pypi';
    return 'npm'; // default
}

function installNpm(pkg) {
    console.log(`  ${c.yellow}📦 npm i -g ${pkg}${c.reset}`);
    exec(`npm i -g ${pkg}`);
    // Find binary name: last segment of package name
    const binName = pkg.split('/').pop();
    let binPath;
    try { binPath = exec(`which ${binName}`); } catch { binPath = binName; }
    return { command: binName, args: [], bin: binPath };
}

function installPypi(pkg) {
    // Prefer uv tool install (faster), fallback to pip
    const hasUv = (() => { try { exec('which uv'); return true; } catch { return false; } })();
    if (hasUv) {
        console.log(`  ${c.yellow}📦 uv tool install ${pkg}${c.reset}`);
        try {
            exec(`uv tool install ${pkg}`);
        } catch {
            // uv tool install might fail if already installed, try upgrade
            try { exec(`uv tool upgrade ${pkg}`); } catch { }
        }
    } else {
        console.log(`  ${c.yellow}📦 pip install ${pkg}${c.reset}`);
        exec(`pip install ${pkg}`);
    }
    // Find binary: usually same as package name
    const binName = pkg;
    let binPath;
    try { binPath = exec(`which ${binName}`); } catch { binPath = binName; }
    return { command: binPath || binName, args: [], bin: binPath };
}

function syncAll(config) {
    try {
        // Dynamic import of mcp-sync for syncToAll
        const settingsPath = join(CLAW_HOME, 'settings.json');
        let workingDir = homedir();
        try {
            const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
            workingDir = settings.workingDir || workingDir;
        } catch { }

        // Inline sync to Claude (most critical target)
        const claudePath = join(workingDir, '.mcp.json');
        const mcpServers = {};
        for (const [name, srv] of Object.entries(config.servers || {})) {
            mcpServers[name] = { command: srv.command, args: srv.args || [] };
            if (srv.env && Object.keys(srv.env).length) mcpServers[name].env = srv.env;
        }
        let existing = {};
        try { existing = JSON.parse(readFileSync(claudePath, 'utf8')); } catch { }
        existing.mcpServers = mcpServers;
        writeFileSync(claudePath, JSON.stringify(existing, null, 4) + '\n');
        console.log(`  ${c.green}✅ Claude:${c.reset} ${claudePath}`);

        // Codex TOML patch
        const codexPath = join(homedir(), '.codex', 'config.toml');
        if (existsSync(codexPath)) {
            const toml = readFileSync(codexPath, 'utf8');
            let mcpToml = '';
            for (const [name, srv] of Object.entries(config.servers || {})) {
                mcpToml += `[mcp_servers.${name}]\n`;
                mcpToml += `command = "${srv.command}"\n`;
                mcpToml += `args = ${JSON.stringify(srv.args || [])}\n`;
                if (srv.env && Object.keys(srv.env).length) {
                    mcpToml += `[mcp_servers.${name}.env]\n`;
                    for (const [k, v] of Object.entries(srv.env)) {
                        mcpToml += `${k} = "${v}"\n`;
                    }
                }
                mcpToml += '\n';
            }
            // Patch: remove existing mcp_servers sections, append new
            const lines = toml.split('\n');
            const out = [];
            let inMcp = false;
            for (const line of lines) {
                if (/^\[mcp_servers\./.test(line)) { inMcp = true; continue; }
                if (inMcp && /^\[/.test(line) && !/^\[mcp_servers\./.test(line)) inMcp = false;
                if (!inMcp) out.push(line);
            }
            while (out.length && out[out.length - 1].trim() === '') out.pop();
            writeFileSync(codexPath, out.join('\n') + '\n\n' + mcpToml);
            console.log(`  ${c.green}✅ Codex:${c.reset} ${codexPath}`);
        }

        console.log(`  ${c.green}✅ Synced${c.reset}`);
    } catch (e) {
        console.error(`  ${c.red}❌ Sync error: ${e.message}${c.reset}`);
    }
}

// ─── CLI Routing ─────────────────────────────
const sub = process.argv[3];
const arg = process.argv[4];

switch (sub) {
    case 'install': {
        if (!arg) {
            console.log(`\n  Usage: cli-claw mcp install <package> [--pypi|--npm]\n`);
            console.log(`  Examples:`);
            console.log(`    cli-claw mcp install @modelcontextprotocol/server-filesystem`);
            console.log(`    cli-claw mcp install mcp-server-fetch --pypi`);
            console.log(`    cli-claw mcp install @upstash/context7-mcp\n`);
            process.exit(1);
        }

        const forceFlag = process.argv.includes('--pypi') ? 'pypi'
            : process.argv.includes('--npm') ? 'npm' : null;
        const eco = detectEcosystem(arg, forceFlag);
        const config = loadMcp();
        const serverName = arg.split('/').pop().replace(/^@/, '');

        console.log(`\n  ${c.bold}Installing ${arg}${c.reset} (${eco})\n`);

        try {
            const result = eco === 'pypi' ? installPypi(arg) : installNpm(arg);

            // Add to mcp.json
            config.servers[serverName] = {
                command: result.command,
                args: result.args,
            };
            saveMcp(config);
            console.log(`  ${c.green}✅ Added to mcp.json:${c.reset} ${serverName}`);

            // Sync
            syncAll(config);
            console.log(`\n  ${c.green}Done!${c.reset} Server "${serverName}" ready for all CLIs.\n`);
        } catch (e) {
            console.error(`\n  ${c.red}❌ Install failed: ${e.message}${c.reset}\n`);
            process.exit(1);
        }
        break;
    }

    case 'sync': {
        const config = loadMcp();
        console.log(`\n  ${c.bold}Syncing MCP config → all CLIs${c.reset}\n`);
        syncAll(config);
        console.log('');
        break;
    }

    case 'list':
    case undefined: {
        const config = loadMcp();
        const entries = Object.entries(config.servers || {});
        console.log(`\n  ${c.bold}🔌 MCP Servers${c.reset} (${entries.length})\n`);
        if (!entries.length) {
            console.log(`  ${c.dim}(none)${c.reset}`);
        } else {
            for (const [name, srv] of entries) {
                const cmd = srv.args?.length
                    ? `${srv.command} ${srv.args.join(' ')}`
                    : srv.command;
                console.log(`  ${c.cyan}•${c.reset} ${c.bold}${name}${c.reset}  ${c.dim}${cmd}${c.reset}`);
            }
        }
        console.log(`\n  ${c.dim}cli-claw mcp install <pkg>  — 새 MCP 서버 설치${c.reset}`);
        console.log(`  ${c.dim}cli-claw mcp sync           — 4개 CLI에 동기화${c.reset}\n`);
        break;
    }

    default:
        console.error(`  ${c.red}Unknown mcp subcommand: ${sub}${c.reset}`);
        console.log(`  Try: cli-claw mcp install <pkg>\n`);
        process.exit(1);
}

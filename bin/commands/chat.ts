/**
 * cli-jaw chat — Phase 9.5
 * Three modes: default (raw stdin, persistent footer), --raw (JSON in UI), --simple (plain readline)
 */
import { parseArgs } from 'node:util';
import WebSocket from 'ws';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve as resolvePath, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { loadLocales } from '../../src/core/i18n.js';
import { consumePasteProtocol, getComposerDisplayText, setBracketedPaste } from '../../src/cli/tui/composer.js';
import { cleanupScrollRegion, resolveShellLayout, setupScrollRegion } from '../../src/cli/tui/shell.js';
import { createTuiStore } from '../../src/cli/tui/store.js';
import { isGitRepo, detectIde } from '../../src/ide/diff.js';
import { shouldShowHelp, printAndExit } from '../helpers/help.js';

if (shouldShowHelp(process.argv)) printAndExit(`
  jaw chat — interactive terminal REPL

  Usage: jaw chat [--port <3457>] [--raw] [--simple]

  Connects to the running jaw server for interactive chat.
  Server must be running first (jaw serve).

  Modes:
    (default)    Rich TUI with persistent footer
    --raw        JSON protocol mode (for UI integration)
    --simple     Plain readline (minimal)

  Options:
    --port <N>   Server port (default: 3457)
`);
import { APP_VERSION, getServerUrl, getWsUrl } from '../../src/core/config.js';
import { c, cliColor, cliLabel, hrLine, getRows, ESC_WAIT_MS, type TuiContext } from './tui/types.js';
import { runSimpleMode } from './tui/simple-mode.js';
import { openPromptBlock } from './tui/renderer.js';
import { redrawInputWithAutocomplete, handleResize } from './tui/overlays.js';
import { handleKeyInput, flushPendingEscape } from './tui/input-handler.js';
import { handleWsMessage } from './tui/ws-handler.js';
import { asRecord, fieldString } from '../_http-client.js';

// ─── Init ────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_SCRIPT = resolvePath(__dirname, 'skill.js');

function findPackageRoot(start: string): string {
    let dir = start;
    for (let i = 0; i < 5; i++) {
        if (fs.existsSync(join(dir, 'public', 'locales'))) return dir;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return resolvePath(start, '../..');
}
loadLocales(join(findPackageRoot(__dirname), 'public', 'locales'));

const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
        port: { type: 'string', default: process.env["PORT"] || '3457' },
        raw: { type: 'boolean', default: false },
        simple: { type: 'boolean', default: false },
    },
    strict: false,
});

// ─── Connect ─────────────────────────────────
const wsUrl = getWsUrl(values.port as string);
const apiUrl = getServerUrl(values.port as string);

let ws: WebSocket;
try {
    ws = await new Promise<WebSocket>((resolve, reject) => {
        const s = new WebSocket(wsUrl);
        s.on('open', () => resolve(s));
        s.on('error', reject);
    });
} catch {
    console.error(`\n  ${c.red}x${c.reset} Cannot connect to ${wsUrl}`);
    console.error(`  Run ${c.cyan}cli-jaw serve${c.reset} first\n`);
    process.exit(1);
}

// ─── Fetch info ──────────────────────────────
let info = { cli: 'codex', workingDir: '~', model: '' };
let runtimeLocale = 'ko';
let tuiConfig = { pasteCollapseLines: 2, pasteCollapseChars: 160, keymapPreset: 'default', diffStyle: 'summary', themeSeed: 'jaw-default' };
try {
    const r = await fetch(`${apiUrl}/api/settings`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
        const res = asRecord(await r.json());
        const s = asRecord(res["data"] || res);
        const cli = fieldString(s["cli"], 'codex');
        const perCli = asRecord(s["perCli"]);
        const cliSettings = asRecord(perCli[cli]);
        info = { cli, workingDir: fieldString(s["workingDir"], '~'), model: fieldString(cliSettings["model"]) };
        if (typeof s["locale"] === 'string') runtimeLocale = s["locale"];
        if (s["tui"] && typeof s["tui"] === 'object') tuiConfig = { ...tuiConfig, ...asRecord(s["tui"]) };
    }
    const sr = await fetch(`${apiUrl}/api/session`, { signal: AbortSignal.timeout(2000) });
    if (sr.ok) {
        const ses = asRecord(await sr.json());
        const sd = asRecord(ses["data"] || ses);
        if (typeof sd["model"] === 'string') info.model = sd["model"];
    }
} catch { /* keep defaults */ }

const chatCwd = process.cwd();
const isGit = isGitRepo(chatCwd);
const detectedIde = detectIde();

// ─── Build TuiContext ────────────────────────
const ctx: TuiContext = {
    ws, apiUrl,
    info,
    accent: cliColor[info.cli] || c.red,
    label: cliLabel[info.cli] || info.cli,
    dir: info.workingDir.replace(homedir(), '~'),
    runtimeLocale,
    tuiConfig,
    values: { port: values.port as string, raw: !!values.raw, simple: !!values.simple },
    isRaw: !!values.raw,
    store: createTuiStore(),
    overlayBoxHeight: 0,
    inputActive: true,
    streaming: false,
    commandRunning: false,
    escPending: false,
    escTimer: null,
    prevLineCount: 1,
    resizeTimer: null,
    ideEnabled: isGit,
    idePopEnabled: false,
    preFileSetQueue: [],
    chatCwd,
    isGit,
    detectedIde,
    promptPrefix: '',
    footer: '',
};
ctx.footer = `  ${c.dim}${ctx.accent}${ctx.label}${c.reset}${c.dim}  |  /quit  |  /clear${c.reset}`;
ctx.promptPrefix = `  ${ctx.accent}\u276F${c.reset} `;

// ─── Mode branch ─────────────────────────────
if (values.simple) {
    await runSimpleMode(ctx);
} else {
    // Banner
    const modelStr = info.model ? `${c.dim}model:${c.reset}     ${c.bold}${info.model}${c.reset}` : '';
    const art = [
        '\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557     \u2588\u2588\u2557     \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557    \u2588\u2588\u2557',
        '\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551    \u2588\u2588\u2551',
        '\u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551 \u2588\u2557 \u2588\u2588\u2551',
        '\u2588\u2588\u2551     \u2588\u2588\u2551     \u2588\u2588\u2551\u2588\u2588   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551\u2588\u2588\u2588\u2557\u2588\u2588\u2551',
        '\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551\u255A\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551  \u2588\u2588\u2551\u255A\u2588\u2588\u2588\u2554\u2588\u2588\u2588\u2554\u255D',
        ' \u255A\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u255D  \u255A\u2550\u255D \u255A\u2550\u2550\u255D\u255A\u2550\u2550\u255D',
    ];
    console.log('');
    for (const line of art) console.log(`  ${c.cyan}${c.bold}${line}${c.reset}`);
    console.log(`  ${c.dim}v${APP_VERSION}${c.reset}${ctx.isRaw ? `  ${c.dim}(raw json)${c.reset}` : ''}`);
    console.log('');
    console.log(`  ${c.dim}engine:${c.reset}    ${ctx.accent}${ctx.label}${c.reset}`);
    if (modelStr) console.log(`  ${modelStr}`);
    console.log(`  ${c.dim}directory:${c.reset}  ${c.cyan}${ctx.dir}${c.reset}`);
    console.log(`  ${c.dim}server:${c.reset}    ${c.green}\u25CF${c.reset} localhost:${values.port}`);
    if (ctx.ideEnabled) {
        const ideName = detectedIde || 'terminal';
        console.log(`  ${c.dim}ide diff:${c.reset}  ${c.green}\u25CF${c.reset} ON (${ideName}, git)`);
    } else if (!isGit) {
        console.log(`  ${c.dim}ide diff:${c.reset}  ${c.yellow}\u25CB${c.reset} OFF (non-git)`);
    }
    console.log('');
    console.log(`  ${c.dim}/quit to exit, /clear to clear screen, /reset confirm to factory reset${c.reset}`);
    console.log(`  ${c.dim}/file <path> to attach${c.reset}`);

    // ─── Raw stdin ───────────────────────────
    process.stdin.setRawMode(true);
    setBracketedPaste(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdout.on('resize', () => {
        if (ctx.resizeTimer) clearTimeout(ctx.resizeTimer);
        ctx.resizeTimer = setTimeout(() => { ctx.resizeTimer = null; handleResize(ctx); }, 50);
    });

    process.stdin.on('data', (_key) => {
        let incoming = _key as unknown as string;
        if (ctx.escPending) {
            if (ctx.escTimer) clearTimeout(ctx.escTimer);
            ctx.escTimer = null;
            ctx.escPending = false;
            if (!incoming.startsWith('\x1b')) incoming = `\x1b${incoming}`;
        }
        if (incoming === '\x1b') {
            ctx.escPending = true;
            ctx.escTimer = setTimeout(() => flushPendingEscape(ctx), ESC_WAIT_MS);
            return;
        }
        if (ctx.commandRunning && !ctx.inputActive) return;
        const composer = ctx.store.composer;
        const beforeDisplay = getComposerDisplayText(composer);
        const tokens = consumePasteProtocol(incoming, ctx.store.pasteCapture, composer, {
            collapseLines: ctx.tuiConfig.pasteCollapseLines,
            collapseChars: ctx.tuiConfig.pasteCollapseChars,
        });
        const afterDisplay = getComposerDisplayText(composer);
        if (beforeDisplay !== afterDisplay) {
            if (!ctx.inputActive) {
                if (ctx.commandRunning) return;
                ctx.inputActive = true;
                openPromptBlock(ctx);
            }
            redrawInputWithAutocomplete(ctx);
            if (tokens.length === 0) return;
        }
        for (const token of tokens) handleKeyInput(ctx, token);
    });

    // ─── WS messages ─────────────────────────
    ws.on('message', (data: WebSocket.RawData) => handleWsMessage(ctx, data));

    ws.on('close', () => {
        cleanupScrollRegion(resolveShellLayout(process.stdout.columns || 80, getRows(), ctx.store.panes));
        console.log(`\n  ${c.dim}Disconnected${c.reset}\n`);
        setBracketedPaste(false);
        process.stdin.setRawMode(false);
        process.exit(0);
    });

    setupScrollRegion(ctx.footer, `  ${c.dim}${hrLine()}${c.reset}`, resolveShellLayout(process.stdout.columns || 80, getRows(), ctx.store.panes));
    openPromptBlock(ctx);
}

// ─── Utilities (kept for external use) ───────
export function runSkillResetLocal() {
    const proc = spawnSync(
        process.execPath,
        [SKILL_SCRIPT, 'reset', '--force'],
        { encoding: 'utf8', timeout: 120000 },
    );
    if (proc.error) throw proc.error;
    if (proc.status !== 0) {
        const msg = (proc.stderr || proc.stdout || `exit ${proc.status}`).trim();
        throw new Error(msg);
    }
}

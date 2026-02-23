/**
 * cli-claw chat — Phase 9.5
 * Three modes: default (fancy ANSI), --raw (JSON in same UI), --simple (plain text)
 */
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import WebSocket from 'ws';

const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
        port: { type: 'string', default: process.env.PORT || '3457' },
        raw: { type: 'boolean', default: false },
        simple: { type: 'boolean', default: false },
    },
    strict: false,
});

// ─── ANSI ────────────────────────────────────
const c = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

// ─── Connect ─────────────────────────────────
const wsUrl = `ws://localhost:${values.port}`;
const apiUrl = `http://localhost:${values.port}`;

let ws;
try {
    ws = await new Promise((resolve, reject) => {
        const s = new WebSocket(wsUrl);
        s.on('open', () => resolve(s));
        s.on('error', reject);
    });
} catch {
    console.error(`\n  ${c.red}x${c.reset} Cannot connect to ${wsUrl}`);
    console.error(`  Run ${c.cyan}cli-claw serve${c.reset} first\n`);
    process.exit(1);
}

// ─── Fetch info ──────────────────────────────
let info = { cli: 'codex', workingDir: '~' };
try {
    const r = await fetch(`${apiUrl}/api/settings`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) { const s = await r.json(); info = { cli: s.cli || 'codex', workingDir: s.workingDir || '~' }; }
} catch { }

const cliLabel = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' };
const cliColor = { claude: c.magenta, codex: c.red, gemini: c.blue };
const accent = cliColor[info.cli] || c.red;
const label = cliLabel[info.cli] || info.cli;
const dir = info.workingDir.replace(process.env.HOME, '~');

// ─── Width helper ────────────────────────────
const W = () => Math.max(20, Math.min((process.stdout.columns || 60) - 4, 60));
const hrLine = () => '-'.repeat(W());

// ─── Simple mode (no ANSI tricks at all) ─────
if (values.simple) {
    console.log(`\n  cli-claw v0.1.0 · ${label} · :${values.port}\n`);
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: `${label} > ` });
    let streaming = false;
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'agent_chunk') { if (!streaming) streaming = true; process.stdout.write(msg.text || ''); }
            else if (msg.type === 'agent_done') {
                if (streaming) { process.stdout.write('\n\n'); streaming = false; }
                else if (msg.text) console.log(msg.text + '\n');
                rl.prompt();
            }
            else if (msg.type === 'agent_status' && msg.status === 'running')
                process.stdout.write(`[${msg.agentName || msg.agentId}] working...\r`);
        } catch { }
    });
    rl.on('line', (line) => {
        const t = line.trim();
        if (!t) { rl.prompt(); return; }
        if (t === '/quit' || t === '/q') { ws.close(); rl.close(); process.exit(0); }
        ws.send(JSON.stringify({ type: 'send_message', text: t }));
    });
    rl.on('close', () => { ws.close(); process.exit(0); });
    ws.on('close', () => { console.log('Disconnected'); process.exit(0); });
    rl.prompt();

} else {
    // ─── Shared UI for default + raw ─────────
    const isRaw = values.raw;

    // Banner
    console.log('');
    console.log(`  ${c.bold}cli-claw${c.reset} ${c.dim}v0.1.0${c.reset}${isRaw ? `  ${c.dim}(raw json)${c.reset}` : ''}`);
    console.log('');
    console.log(`  ${c.dim}engine:${c.reset}    ${accent}${label}${c.reset}`);
    console.log(`  ${c.dim}directory:${c.reset}  ${c.cyan}${dir}${c.reset}`);
    console.log(`  ${c.dim}server:${c.reset}    ${c.green}\u25CF${c.reset} localhost:${values.port}`);
    console.log('');
    console.log(`  ${c.dim}/quit to exit, /clear to reset${c.reset}`);

    // Prompt string — use rl.setPrompt so readline knows its width
    const promptStr = `  ${accent}\u276F${c.reset} `;
    const footer = `  ${c.dim}${accent}${label}${c.reset}${c.dim}  |  /quit  |  /clear${c.reset}`;

    function showInput() {
        console.log('');
        console.log(`  ${c.dim}${hrLine()}${c.reset}`);
        // Print prompt via rl so it tracks width for backspace
        rl.setPrompt(promptStr);
        // Pre-draw bottom hr + footer below, then cursor back up
        process.stdout.write('\x1b[s');  // save cursor pos (will be after rl.prompt)
        // We need to write the bottom content AFTER rl.prompt renders
        // So schedule it in next tick
        setImmediate(() => {
            process.stdout.write('\x1b[s');
            process.stdout.write(`\n  ${c.dim}${hrLine()}${c.reset}`);
            process.stdout.write(`\n${footer}`);
            process.stdout.write('\x1b[u');
        });
        rl.prompt();
    }

    function onInputDone() {
        // Advance past the pre-drawn bottom hr + footer, clearing them
        process.stdout.write('\n\x1b[2K');
        process.stdout.write('\n\x1b[2K');
    }

    // ─── REPL ────────────────────────────────
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let streaming = false;

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            switch (msg.type) {
                case 'agent_chunk':
                    if (!streaming) {
                        streaming = true;
                        console.log('');
                        if (!isRaw) process.stdout.write('  ');
                    }
                    if (isRaw) {
                        console.log(`  ${c.dim}${JSON.stringify(msg)}${c.reset}`);
                    } else {
                        process.stdout.write((msg.text || '').replace(/\n/g, '\n  '));
                    }
                    break;

                case 'agent_done':
                    if (isRaw) {
                        console.log(`  ${c.dim}${JSON.stringify(msg)}${c.reset}`);
                    } else if (streaming) {
                        console.log('');
                    } else if (msg.text) {
                        console.log('');
                        console.log(`  ${msg.text.replace(/\n/g, '\n  ')}`);
                    }
                    streaming = false;
                    showInput();
                    break;

                case 'agent_status':
                    if (isRaw) {
                        console.log(`  ${c.dim}${JSON.stringify(msg)}${c.reset}`);
                    } else if (msg.status === 'running') {
                        const name = msg.agentName || msg.agentId || 'agent';
                        process.stdout.write(`\r  ${c.yellow}\u25CF${c.reset} ${c.dim}${name} working...${c.reset}          \r`);
                    }
                    break;

                case 'new_message':
                    if (isRaw) {
                        console.log(`  ${c.dim}${JSON.stringify(msg)}${c.reset}`);
                    } else if (msg.source && msg.source !== 'cli') {
                        console.log(`\n  ${c.dim}[${msg.source}]${c.reset} ${(msg.content || '').slice(0, 60)}`);
                    }
                    break;

                default:
                    if (isRaw) {
                        console.log(`  ${c.dim}${JSON.stringify(msg)}${c.reset}`);
                    }
                    break;
            }
        } catch { }
    });

    rl.on('line', (line) => {
        const text = line.trim();
        onInputDone();
        if (!text) { showInput(); return; }
        if (text === '/quit' || text === '/exit' || text === '/q') {
            console.log(`\n  ${c.dim}Bye! \uD83E\uDD9E${c.reset}\n`);
            ws.close(); rl.close(); process.exit(0);
        }
        if (text === '/clear') { console.clear(); showInput(); return; }
        ws.send(JSON.stringify({ type: 'send_message', text }));
    });

    rl.on('close', () => { ws.close(); process.exit(0); });
    ws.on('close', () => { console.log(`\n  ${c.dim}Disconnected${c.reset}\n`); process.exit(0); });

    showInput();
}

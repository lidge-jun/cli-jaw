/**
 * cli-claw chat — Phase 9.5 (polished)
 * Interactive REPL or --raw ndjson mode via WebSocket.
 * Styled like Codex / Claude Code / OpenCode.
 */
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import WebSocket from 'ws';

const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
        port: { type: 'string', default: process.env.PORT || '3457' },
        raw: { type: 'boolean', default: false },
    },
    strict: false,
});

// ─── ANSI Colors ─────────────────────────────
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    white: '\x1b[97m',
};

// ─── Connect ─────────────────────────────────
const wsUrl = `ws://localhost:${values.port}`;
const apiUrl = `http://localhost:${values.port}`;

function connectWs() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        ws.on('open', () => resolve(ws));
        ws.on('error', (err) => reject(err));
    });
}

let ws;
try {
    ws = await connectWs();
} catch {
    console.error(`\n  ${c.red}✗${c.reset} Cannot connect to ${c.dim}${wsUrl}${c.reset}`);
    console.error(`  ${c.dim}Run ${c.cyan}cli-claw serve${c.reset}${c.dim} first${c.reset}\n`);
    process.exit(1);
}

// ─── Fetch server info ───────────────────────
let serverInfo = { cli: '?', version: '?', workingDir: '~' };
try {
    const res = await fetch(`${apiUrl}/api/settings`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
        const s = await res.json();
        serverInfo = { cli: s.cli || 'codex', workingDir: s.workingDir || '~', version: '0.1.0' };
    }
} catch { }

// ─── CLI color by engine ─────────────────────
const cliColors = {
    claude: { badge: c.bgMagenta + c.white, accent: c.magenta, label: '🟣 Claude Code' },
    codex: { badge: c.bgRed + c.white, accent: c.red, label: '🟠 Codex' },
    gemini: { badge: c.bgBlue + c.white, accent: c.blue, label: '🔵 Gemini CLI' },
};
const theme = cliColors[serverInfo.cli] || cliColors.codex;

// ─── Raw mode ────────────────────────────────
if (values.raw) {
    process.stdin.setEncoding('utf8');
    ws.on('message', (data) => process.stdout.write(data.toString() + '\n'));
    process.stdin.on('data', (chunk) => {
        for (const line of chunk.split('\n').filter(Boolean)) {
            ws.send(JSON.stringify({ type: 'send_message', text: line }));
        }
    });
    process.stdin.on('end', () => { ws.close(); process.exit(0); });

} else {
    // ─── Banner ──────────────────────────────
    const cols = process.stdout.columns || 60;
    const W = Math.min(cols - 4, 56);
    const line = '─'.repeat(W);
    const pad = (s, w) => s + ' '.repeat(Math.max(0, w - stripAnsi(s).length));
    function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
    function boxLine(content) {
        const visible = stripAnsi(content);
        const inner = W - 2;
        return `  ${c.dim}│${c.reset} ${content}${' '.repeat(Math.max(0, inner - visible.length))}${c.dim}│${c.reset}`;
    }

    console.log('');
    console.log(`  ${c.dim}╭${line}╮${c.reset}`);
    console.log(boxLine(`${c.bold}🦞 cli-claw${c.reset} ${c.dim}v${serverInfo.version}${c.reset}`));
    console.log(boxLine(''));
    console.log(boxLine(`${c.dim}engine:${c.reset}    ${theme.accent}${theme.label}${c.reset}`));
    console.log(boxLine(`${c.dim}directory:${c.reset}  ${c.cyan}${serverInfo.workingDir.replace(process.env.HOME, '~')}${c.reset}`));
    console.log(boxLine(`${c.dim}server:${c.reset}    ${c.green}●${c.reset} localhost:${values.port}`));
    console.log(`  ${c.dim}╰${line}╯${c.reset}`);
    console.log('');
    console.log(`  ${c.dim}Type a message to chat. ${c.cyan}/quit${c.dim} to exit.${c.reset}`);
    console.log('');

    // ─── REPL ────────────────────────────────
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `  ${theme.accent}❯${c.reset} `,
    });

    let streaming = false;
    let streamBuf = '';

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());

            switch (msg.type) {
                case 'agent_chunk':
                    if (!streaming) {
                        streaming = true;
                        streamBuf = '';
                        process.stdout.write(`\n  ${c.dim}┌─ response ─────────────${c.reset}\n  ${c.dim}│${c.reset} `);
                    }
                    // Wrap long lines and indent
                    const text = (msg.text || '').replace(/\n/g, `\n  ${c.dim}│${c.reset} `);
                    process.stdout.write(text);
                    streamBuf += msg.text || '';
                    break;

                case 'agent_done':
                    if (streaming) {
                        process.stdout.write(`\n  ${c.dim}└────────────────────────${c.reset}\n\n`);
                        streaming = false;
                    } else if (msg.text) {
                        console.log(`\n  ${c.dim}┌─ response ─────────────${c.reset}`);
                        console.log(`  ${c.dim}│${c.reset} ${msg.text.replace(/\n/g, `\n  ${c.dim}│${c.reset} `)}`);
                        console.log(`  ${c.dim}└────────────────────────${c.reset}\n`);
                    }
                    rl.prompt();
                    break;

                case 'new_message':
                    if (msg.source && msg.source !== 'cli') {
                        console.log(`  ${c.dim}[${msg.source}]${c.reset} ${c.cyan}${(msg.content || '').slice(0, 60)}${c.reset}`);
                    }
                    break;

                case 'agent_status':
                    if (msg.status === 'running') {
                        const name = msg.agentName || msg.agentId || 'agent';
                        process.stdout.write(`  ${c.yellow}⠋${c.reset} ${c.dim}${name} working...${c.reset}\r`);
                    } else if (msg.status === 'idle') {
                        process.stdout.write('\x1b[2K\r');
                    }
                    break;

                case 'round_start':
                    console.log(`  ${c.cyan}◆${c.reset} ${c.dim}Round ${msg.round} — ${(msg.subtasks || []).length} subtasks${c.reset}`);
                    break;
            }
        } catch { }
    });

    rl.on('line', (line) => {
        const text = line.trim();
        if (!text) { rl.prompt(); return; }
        if (text === '/quit' || text === '/exit' || text === '/q') {
            console.log(`\n  ${c.dim}Bye! 🦞${c.reset}\n`);
            ws.close();
            rl.close();
            process.exit(0);
        }
        if (text === '/clear') {
            console.clear();
            rl.prompt();
            return;
        }
        if (text === '/status') {
            console.log(`  ${c.dim}engine:${c.reset} ${theme.label}  ${c.dim}server:${c.reset} ${c.green}●${c.reset} :${values.port}`);
            rl.prompt();
            return;
        }
        ws.send(JSON.stringify({ type: 'send_message', text }));
    });

    rl.on('close', () => { ws.close(); process.exit(0); });

    ws.on('close', () => {
        console.log(`\n  ${c.dim}Connection closed${c.reset}\n`);
        process.exit(0);
    });

    rl.prompt();
}

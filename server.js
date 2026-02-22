import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync, spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Config ──────────────────────────────────────────

const PORT = process.env.PORT || 3457;
const CLAW_HOME = join(os.homedir(), '.cli-claw');
const PROMPTS_DIR = join(CLAW_HOME, 'prompts');
const DB_PATH = join(__dirname, 'claw.db');
const SETTINGS_PATH = join(__dirname, 'settings.json');

// ─── Ensure directories ─────────────────────────────

fs.mkdirSync(PROMPTS_DIR, { recursive: true });
fs.mkdirSync(join(__dirname, 'public'), { recursive: true });

// ─── A-1 Core System Prompt (immutable) ──────────────

const A1_CONTENT = `# Claw Agent

You are Claw Agent, a system-level AI assistant.
Execute tasks on the user's computer via CLI tools.

## Rules
- Follow the user's instructions precisely
- Respond in the user's language
- Report results clearly with file paths and outputs
- Ask for clarification when ambiguous
- If nothing needs attention on heartbeat, reply HEARTBEAT_OK
`;

// Ensure A-1.md exists
const A1_PATH = join(PROMPTS_DIR, 'A-1.md');
if (!fs.existsSync(A1_PATH)) {
    fs.writeFileSync(A1_PATH, A1_CONTENT);
}

// ─── A-2 User Prompt (mutable, default) ──────────────

const A2_DEFAULT = `# User Configuration

## Identity
- Name: Claw
- Emoji: 🦞

## User
- Name: (your name)
- Language: English
- Timezone: UTC

## Vibe
- Friendly, warm
- Technically accurate

## Working Directory
- ~/
`;

const A2_PATH = join(PROMPTS_DIR, 'A-2.md');
if (!fs.existsSync(A2_PATH)) {
    fs.writeFileSync(A2_PATH, A2_DEFAULT);
}

// ─── HEARTBEAT.md (separate) ─────────────────────────

const HEARTBEAT_DEFAULT = `# Heartbeat checklist

<!-- Keep this empty to skip heartbeat API calls -->
<!-- Add tasks below when you want periodic checks -->
`;

const HEARTBEAT_PATH = join(PROMPTS_DIR, 'HEARTBEAT.md');
if (!fs.existsSync(HEARTBEAT_PATH)) {
    fs.writeFileSync(HEARTBEAT_PATH, HEARTBEAT_DEFAULT);
}

// ─── B.md (auto-generated: A-1 + A-2) ───────────────

function regenerateB() {
    const a1 = fs.readFileSync(A1_PATH, 'utf8');
    const a2 = fs.existsSync(A2_PATH) ? fs.readFileSync(A2_PATH, 'utf8') : '';
    fs.writeFileSync(join(PROMPTS_DIR, 'B.md'), `${a1}\n---\n\n${a2}`);
}
regenerateB();

function getSystemPrompt() {
    const a1 = fs.readFileSync(A1_PATH, 'utf8');
    const a2 = fs.existsSync(A2_PATH) ? fs.readFileSync(A2_PATH, 'utf8') : '';
    return `${a1}\n\n${a2}`;
}

// ─── Settings ────────────────────────────────────────

const DEFAULT_SETTINGS = {
    cli: 'claude',
    permissions: 'auto',      // safe | auto
    workingDir: os.homedir(),
    perCli: {
        claude: { model: 'claude-sonnet-4-5-20250929', effort: 'medium' },
        codex: { model: 'gpt-5.3-codex', effort: 'medium' },
        gemini: { model: 'gemini-2.5-pro', effort: '' },
        opencode: { model: 'github-copilot/claude-sonnet-4.5', effort: '' },
    },
    heartbeat: {
        enabled: false,
        every: '30m',
        activeHours: { start: '08:00', end: '22:00' },
        target: 'all',
    },
    telegram: {
        enabled: false,
        token: '',
        allowedChatIds: [],
    },
    employees: [],
};

function loadSettings() {
    try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) };
    } catch { return { ...DEFAULT_SETTINGS }; }
}

function saveSettings(s) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
}

let settings = loadSettings();

// ─── Database ────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS session (
        id          TEXT PRIMARY KEY DEFAULT 'default',
        active_cli  TEXT DEFAULT 'claude',
        session_id  TEXT,
        model       TEXT DEFAULT 'default',
        permissions TEXT DEFAULT 'auto',
        working_dir TEXT DEFAULT '~',
        effort      TEXT DEFAULT 'medium',
        updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO session (id) VALUES ('default');

    CREATE TABLE IF NOT EXISTS messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        role        TEXT NOT NULL,
        content     TEXT NOT NULL,
        cli         TEXT,
        model       TEXT,
        cost_usd    REAL,
        duration_ms INTEGER,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

    CREATE TABLE IF NOT EXISTS memory (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        key         TEXT NOT NULL UNIQUE,
        value       TEXT NOT NULL,
        source      TEXT DEFAULT 'manual',
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS employees (
        id          TEXT PRIMARY KEY,
        name        TEXT DEFAULT 'New Agent',
        cli         TEXT DEFAULT 'claude',
        model       TEXT DEFAULT 'default',
        role        TEXT DEFAULT '',
        status      TEXT DEFAULT 'idle',
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// ─── DB Helpers ──────────────────────────────────────

const getSession = () => db.prepare('SELECT * FROM session WHERE id = ?').get('default');
const updateSession = db.prepare(`
    UPDATE session SET active_cli=?, session_id=?, model=?, permissions=?, working_dir=?, effort=?, updated_at=CURRENT_TIMESTAMP
    WHERE id='default'
`);
const insertMessage = db.prepare('INSERT INTO messages (role, content, cli, model) VALUES (?, ?, ?, ?)');
const getMessages = db.prepare('SELECT * FROM messages ORDER BY id ASC');
const getRecentMessages = db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?');
const clearMessages = db.prepare('DELETE FROM messages');
const getMemory = db.prepare('SELECT key, value, source FROM memory ORDER BY updated_at DESC');
const upsertMemory = db.prepare(`
    INSERT INTO memory (key, value, source) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, source=excluded.source, updated_at=CURRENT_TIMESTAMP
`);
const deleteMemory = db.prepare('DELETE FROM memory WHERE key = ?');
const getEmployees = db.prepare('SELECT * FROM employees ORDER BY created_at ASC');
const insertEmployee = db.prepare('INSERT INTO employees (id, name, cli, model, role) VALUES (?, ?, ?, ?, ?)');
const deleteEmployee = db.prepare('DELETE FROM employees WHERE id = ?');

// ─── CLI Detection ───────────────────────────────────

function detectCli(name) {
    try {
        const p = execSync(`which ${name}`, { encoding: 'utf8', timeout: 3000 }).trim();
        return { available: true, path: p };
    } catch { return { available: false, path: null }; }
}

function detectAllCli() {
    return {
        claude: detectCli('claude'),
        codex: detectCli('codex'),
        gemini: detectCli('gemini'),
        opencode: detectCli('opencode'),
    };
}

// ─── Quota (ported from claw-lite) ───────────────────

function readClaudeCreds() {
    try {
        const raw = execSync(
            'security find-generic-password -s "Claude Code-credentials" -w',
            { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
        ).toString().trim();
        const oauth = JSON.parse(raw)?.claudeAiOauth;
        if (!oauth?.accessToken) return null;
        return {
            token: oauth.accessToken,
            account: {
                type: oauth.subscriptionType ?? 'unknown',
                tier: oauth.rateLimitTier ?? null,
            },
        };
    } catch { return null; }
}

function readCodexTokens() {
    try {
        const authPath = join(os.homedir(), '.codex', 'auth.json');
        const j = JSON.parse(fs.readFileSync(authPath, 'utf8'));
        if (j?.tokens?.access_token) {
            return { access_token: j.tokens.access_token, account_id: j.tokens.account_id ?? '' };
        }
    } catch { }
    return null;
}

async function fetchClaudeUsage(creds) {
    if (!creds?.token) return null;
    try {
        const resp = await fetch('https://api.anthropic.com/api/oauth/usage', {
            headers: {
                'Authorization': `Bearer ${creds.token}`,
                'anthropic-beta': 'oauth-2025-04-20',
            },
            signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        const windows = [];
        const labelMap = { five_hour: '5-hour', seven_day: '7-day', seven_day_sonnet: '7-day Sonnet', seven_day_opus: '7-day Opus' };
        for (const [key, label] of Object.entries(labelMap)) {
            if (data[key]?.utilization != null) {
                windows.push({ label, percent: Math.round(data[key].utilization), resetsAt: data[key].resets_at ?? null });
            }
        }
        return { account: creds.account, windows, raw: data };
    } catch { return null; }
}

async function fetchCodexUsage(tokens) {
    if (!tokens) return null;
    try {
        const resp = await fetch('https://chatgpt.com/backend-api/wham/usage', {
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
                'ChatGPT-Account-Id': tokens.account_id ?? '',
            },
            signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        const account = { email: data.email ?? null, plan: data.plan_type ?? null };
        const windows = [];
        if (data.rate_limit?.primary_window) {
            windows.push({ label: '5-hour', percent: data.rate_limit.primary_window.used_percent ?? 0, resetsAt: data.rate_limit.primary_window.reset_at ? new Date(data.rate_limit.primary_window.reset_at * 1000).toISOString() : null });
        }
        if (data.rate_limit?.secondary_window) {
            windows.push({ label: '7-day', percent: data.rate_limit.secondary_window.used_percent ?? 0, resetsAt: data.rate_limit.secondary_window.reset_at ? new Date(data.rate_limit.secondary_window.reset_at * 1000).toISOString() : null });
        }
        return { account, windows, raw: data };
    } catch { return null; }
}

function readGeminiAccount() {
    try {
        const credsPath = join(os.homedir(), '.gemini', 'oauth_creds.json');
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
        if (creds?.id_token) {
            const payload = JSON.parse(Buffer.from(creds.id_token.split('.')[1], 'base64url').toString());
            return { account: { email: payload.email ?? null }, windows: [] };
        }
    } catch { }
    return null;
}

// ─── Agent Spawn ─────────────────────────────────────

let activeProcess = null;

function makeCleanEnv() {
    const env = { ...process.env };
    delete env.CLAUDE_CODE_SSE_PORT;
    return env;
}

function buildArgs(cli, model, effort, prompt) {
    const sysPrompt = getSystemPrompt();
    switch (cli) {
        case 'claude':
            return ['--print', '--verbose', '--output-format', 'stream-json',
                '--dangerously-skip-permissions',
                '--max-turns', '50',
                ...(model && model !== 'default' ? ['--model', model] : []),
                ...(effort && effort !== 'medium' ? ['--effort', effort] : []),
                '--append-system-prompt', sysPrompt];
        case 'codex':
            return ['exec',
                ...(model && model !== 'default' ? ['-m', model] : []),
                ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []),
                '--full-auto', '--skip-git-repo-check', '--json'];
        case 'gemini':
            return ['-p', prompt || '',
                ...(model && model !== 'default' ? ['-m', model] : []),
                '-y', '-o', 'stream-json',
                '--system-instruction', sysPrompt];
        case 'opencode':
            return ['run',
                ...(model && model !== 'default' ? ['-m', model] : []),
                ...(effort ? ['--variant', effort] : []),
                '--format', 'json'];
        default:
            return [];
    }
}

function buildResumeArgs(cli, model, effort, sessionId, prompt) {
    const sysPrompt = getSystemPrompt();
    switch (cli) {
        case 'claude':
            return ['--print', '--verbose', '--output-format', 'stream-json',
                '--dangerously-skip-permissions',
                '--resume', sessionId,
                '--max-turns', '50',
                ...(model && model !== 'default' ? ['--model', model] : []),
                ...(effort && effort !== 'medium' ? ['--effort', effort] : [])];
        case 'codex':
            return ['exec', 'resume',
                ...(model && model !== 'default' ? ['--model', model] : []),
                '--full-auto', '--skip-git-repo-check',
                sessionId, prompt || '', '--json'];
        case 'gemini':
            return ['--resume', sessionId,
                '-p', prompt || '',
                ...(model && model !== 'default' ? ['-m', model] : []),
                '-y', '-o', 'stream-json'];
        case 'opencode':
            return ['run', '-s', sessionId,
                ...(model && model !== 'default' ? ['-m', model] : []),
                ...(effort ? ['--variant', effort] : []),
                '--format', 'json'];
        default:
            return [];
    }
}

function spawnAgent(prompt) {
    if (activeProcess) {
        console.log('[claw] Agent already running, skipping');
        return;
    }

    const session = getSession();
    const cli = session.active_cli || settings.cli;
    const cfg = settings.perCli?.[cli] || {};
    const model = cfg.model || 'default';
    const effort = cfg.effort || '';

    // Resume or new session
    const isResume = session.session_id;
    let args;
    if (isResume) {
        console.log(`[claw:resume] ${cli} session=${session.session_id.slice(0, 12)}...`);
        args = buildResumeArgs(cli, model, effort, session.session_id, prompt);
    } else {
        args = buildArgs(cli, model, effort, prompt);
    }

    console.log(`[claw] Spawning: ${cli} ${args.join(' ').slice(0, 150)}...`);

    const child = spawn(cli, args, {
        cwd: settings.workingDir,
        env: makeCleanEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    activeProcess = child;

    // Insert user message
    insertMessage.run('user', prompt, cli, model);

    // Send prompt via stdin (skip for gemini which uses -p flag, and codex resume)
    const skipStdin = cli === 'gemini' || (cli === 'codex' && isResume);
    if (!skipStdin) {
        const sysPrompt = getSystemPrompt();
        const stdinContent = `[Claw Platform Context]\n${sysPrompt}\n\n[User Message]\n${prompt}`;
        child.stdin.write(stdinContent);
    }
    child.stdin.end();

    // Broadcast agent status
    broadcast('agent_status', { status: 'running', cli });

    const ctx = { fullText: '', toolLog: [], sessionId: null, cost: null, turns: null, duration: null, tokens: null, stderrBuf: '' };
    let buffer = '';

    child.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const event = JSON.parse(line);
                console.log(`[claw:event] ${cli} type=${event.type} keys=${Object.keys(event).join(',')}`);
                if (!ctx.sessionId) ctx.sessionId = extractSessionId(cli, event);
                extractFromEvent(cli, event, ctx);
            } catch { /* non-JSON line */ }
        }
    });

    child.stderr.on('data', (chunk) => {
        const text = chunk.toString().trim();
        console.error(`[claw:stderr] ${text}`);
        ctx.stderrBuf += text + '\n';
    });

    child.on('close', (code) => {
        activeProcess = null;

        // Save session for resume
        if (ctx.sessionId && code === 0) {
            updateSession.run(cli, ctx.sessionId, model, settings.permissions, settings.workingDir, cfg.effort || 'medium');
            console.log(`[claw:session] saved ${cli} session=${ctx.sessionId.slice(0, 12)}...`);
        }

        if (ctx.fullText.trim()) {
            const costParts = [];
            if (ctx.cost != null) costParts.push(`$${Number(ctx.cost).toFixed(4)}`);
            if (ctx.turns) costParts.push(`${ctx.turns}턴`);
            if (ctx.duration) costParts.push(`${(ctx.duration / 1000).toFixed(1)}s`);
            const costLine = costParts.length ? `\n\n✅ ${costParts.join(' · ')}` : '';
            const finalContent = ctx.fullText.trim() + costLine;

            insertMessage.run('assistant', finalContent, cli, model);
            broadcast('agent_done', { text: finalContent });
        } else {
            let errMsg = `CLI 실행 실패 (exit ${code})`;
            if (ctx.stderrBuf.includes('429') || ctx.stderrBuf.includes('RESOURCE_EXHAUSTED')) {
                errMsg = '⚡ API 용량 초과 (429) — 잠시 후 다시 시도해주세요';
            } else if (ctx.stderrBuf.includes('auth') || ctx.stderrBuf.includes('credentials')) {
                errMsg = '🔐 인증 오류 — CLI 로그인 상태를 확인해주세요';
            } else if (ctx.stderrBuf.trim()) {
                errMsg = ctx.stderrBuf.trim().slice(0, 200);
            }
            broadcast('agent_done', { text: `❌ ${errMsg}`, error: true });
        }

        broadcast('agent_status', { status: code === 0 ? 'done' : 'error' });
        console.log(`[claw] Agent exited with code ${code}, text=${ctx.fullText.length} chars`);
    });
}

// ─── Event Extraction (ported from claw-lite) ────────

function extractSessionId(cli, event) {
    switch (cli) {
        case 'claude': return event.type === 'system' ? event.session_id : null;
        case 'codex': return event.type === 'thread.started' ? event.thread_id : null;
        case 'gemini': return event.type === 'init' ? event.session_id : null;
        case 'opencode': return event.sessionID || null;
        default: return null;
    }
}

function extractFromEvent(cli, event, ctx) {
    switch (cli) {
        case 'claude':
            if (event.type === 'assistant' && event.message?.content) {
                for (const block of event.message.content) {
                    if (block.type === 'tool_use') {
                        ctx.toolLog.push({ name: block.name, input: JSON.stringify(block.input).slice(0, 200) });
                    } else if (block.type === 'text') {
                        ctx.fullText += block.text;
                    }
                }
            } else if (event.type === 'result') {
                ctx.cost = event.total_cost_usd;
                ctx.turns = event.num_turns;
                ctx.duration = event.duration_ms;
                if (event.session_id) ctx.sessionId = event.session_id;
            }
            break;
        case 'codex':
            if (event.type === 'item.completed') {
                if (event.item?.type === 'agent_message') {
                    ctx.fullText += event.item.text || '';
                } else if (event.item?.type === 'command_execution') {
                    ctx.toolLog.push({ name: event.item.command || 'exec', input: (event.item.aggregated_output || '').slice(0, 200) });
                }
            } else if (event.type === 'turn.completed' && event.usage) {
                ctx.tokens = event.usage;
            }
            break;
        case 'gemini':
            if (event.type === 'message' && event.role === 'assistant') {
                ctx.fullText += event.content || '';
            } else if (event.type === 'result') {
                ctx.duration = event.stats?.duration_ms;
                ctx.turns = event.stats?.tool_calls;
            }
            break;
        case 'opencode':
            if (event.type === 'text') {
                ctx.fullText += event.content || '';
            } else if (event.type === 'tool-call') {
                ctx.toolLog.push({ name: event.tool || 'tool', input: '' });
            }
            break;
    }
}

// ─── Express + WebSocket ─────────────────────────────

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// WebSocket broadcast
function broadcast(type, data) {
    const msg = JSON.stringify({ type, ...data, ts: Date.now() });
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

// ─── API Routes ──────────────────────────────────────

// Session
app.get('/api/session', (_, res) => res.json(getSession()));

// Messages
app.get('/api/messages', (_, res) => res.json(getMessages.all()));

// Send message
app.post('/api/message', (req, res) => {
    const { prompt } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: 'prompt required' });
    if (activeProcess) return res.status(409).json({ error: 'agent is busy' });
    spawnAgent(prompt.trim());
    res.json({ ok: true });
});

// Clear (messages only, memory preserved)
app.post('/api/clear', (_, res) => {
    clearMessages.run();
    const session = getSession();
    updateSession.run(session.active_cli, null, session.model, session.permissions, session.working_dir, session.effort);
    broadcast('clear', {});
    res.json({ ok: true });
});

// Settings
app.get('/api/settings', (_, res) => res.json(settings));
app.put('/api/settings', (req, res) => {
    // Deep merge for nested objects
    for (const key of ['perCli', 'heartbeat', 'telegram']) {
        if (req.body[key] && typeof req.body[key] === 'object') {
            settings[key] = { ...settings[key], ...req.body[key] };
            delete req.body[key];
        }
    }
    settings = { ...settings, ...req.body };
    saveSettings(settings);
    const session = getSession();
    const activeModel = settings.perCli?.[settings.cli]?.model || 'default';
    const activeEffort = settings.perCli?.[settings.cli]?.effort || 'medium';
    updateSession.run(
        settings.cli, session.session_id, activeModel,
        settings.permissions, settings.workingDir, activeEffort
    );
    res.json(settings);
});

// Prompts (A-2)
app.get('/api/prompt', (_, res) => {
    const a2 = fs.existsSync(A2_PATH) ? fs.readFileSync(A2_PATH, 'utf8') : '';
    res.json({ content: a2 });
});
app.put('/api/prompt', (req, res) => {
    const { content } = req.body;
    if (content == null) return res.status(400).json({ error: 'content required' });
    fs.writeFileSync(A2_PATH, content);
    regenerateB();
    res.json({ ok: true });
});

// HEARTBEAT.md
app.get('/api/heartbeat-md', (_, res) => {
    const content = fs.existsSync(HEARTBEAT_PATH) ? fs.readFileSync(HEARTBEAT_PATH, 'utf8') : '';
    res.json({ content });
});
app.put('/api/heartbeat-md', (req, res) => {
    const { content } = req.body;
    if (content == null) return res.status(400).json({ error: 'content required' });
    fs.writeFileSync(HEARTBEAT_PATH, content);
    res.json({ ok: true });
});

// Memory
app.get('/api/memory', (_, res) => res.json(getMemory.all()));
app.post('/api/memory', (req, res) => {
    const { key, value, source = 'manual' } = req.body;
    if (!key || !value) return res.status(400).json({ error: 'key and value required' });
    upsertMemory.run(key, value, source);
    res.json({ ok: true });
});
app.delete('/api/memory/:key', (req, res) => {
    deleteMemory.run(req.params.key);
    res.json({ ok: true });
});

// CLI detection
app.get('/api/cli-status', (_, res) => res.json(detectAllCli()));

// Quota (ported from claw-lite)
app.get('/api/quota', async (_, res) => {
    const [claude, codex] = await Promise.all([
        fetchClaudeUsage(readClaudeCreds()),
        fetchCodexUsage(readCodexTokens()),
    ]);
    const gemini = readGeminiAccount();
    res.json({ claude, codex, gemini, opencode: null });
});

// Employees (sub-agents)
app.get('/api/employees', (_, res) => res.json(getEmployees.all()));
app.post('/api/employees', (req, res) => {
    const id = crypto.randomUUID();
    const { name = 'New Agent', cli = 'claude', model = 'default', role = '' } = req.body || {};
    insertEmployee.run(id, name, cli, model, role);
    const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    broadcast('agent_added', emp);
    res.json(emp);
});
app.put('/api/employees/:id', (req, res) => {
    const updates = req.body;
    const allowed = ['name', 'cli', 'model', 'role', 'status'];
    const sets = Object.keys(updates).filter(k => allowed.includes(k)).map(k => `${k} = ?`);
    if (sets.length === 0) return res.status(400).json({ error: 'no valid fields' });
    const vals = sets.map((_, i) => updates[Object.keys(updates).filter(k => allowed.includes(k))[i]]);
    db.prepare(`UPDATE employees SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.params.id);
    const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    broadcast('agent_updated', emp);
    res.json(emp);
});
app.delete('/api/employees/:id', (req, res) => {
    deleteEmployee.run(req.params.id);
    broadcast('agent_deleted', { id: req.params.id });
    res.json({ ok: true });
});

// ─── Start ───────────────────────────────────────────

server.listen(PORT, () => {
    console.log(`\n  🦞 Claw Agent — http://localhost:${PORT}\n`);
    console.log(`  CLI:    ${settings.cli}`);
    console.log(`  Perms:  ${settings.permissions}`);
    console.log(`  CWD:    ${settings.workingDir}`);
    console.log(`  DB:     ${DB_PATH}`);
    console.log(`  Prompts: ${PROMPTS_DIR}\n`);
});

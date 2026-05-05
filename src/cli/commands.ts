// ─── Slash Commands Registry + Dispatcher ───────────────────────────────
// Handlers extracted to commands-handlers.js for 500-line compliance.

import { CLI_KEYS, buildModelChoicesByCli } from './registry.js';
import { t } from '../core/i18n.js';
import {
    formatDuration, unknownCommand, unsupportedCommand, normalizeResult,
    statusHandler, modelHandler, cliHandler, skillHandler, employeeHandler,
    thoughtHandler,
    clearHandler, resetHandler, versionHandler, mcpHandler, memoryHandler,
    browserHandler, promptHandler, quitHandler, fileHandler, fallbackHandler,
    steerHandler, flushHandler, forwardHandler, ideHandler, orchestrateHandler,
    compactHandler,
    modelArgumentCompletions, cliArgumentCompletions, skillArgumentCompletions,
    employeeArgumentCompletions, browserArgumentCompletions, fallbackArgumentCompletions,
    flushArgumentCompletions,
} from './handlers.js';
import type { CliCommandContext } from './command-context.js';
import type {
    SlashCommand, SlashChoice, SlashResult, ParsedSlashCommand, CompletionCtx,
} from './types.js';

const CATEGORY_ORDER = ['session', 'model', 'tools', 'cli'];
const CATEGORY_LABEL = {
    session: 'Session',
    model: 'Model',
    tools: 'Tools',
    cli: 'CLI',
};

function sortCommands(list: SlashCommand[]): SlashCommand[] {
    return [...list].sort((a, b) => {
        const ai = CATEGORY_ORDER.indexOf(a.category || 'tools');
        const bi = CATEGORY_ORDER.indexOf(b.category || 'tools');
        if (ai !== bi) return ai - bi;
        return a.name.localeCompare(b.name);
    });
}

function displayUsage(cmd: SlashCommand): string {
    return `/${cmd.name}${cmd.args ? ` ${cmd.args}` : ''}`;
}

function toChoiceKey(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

function normalizeArgumentCandidate(entry: SlashChoice | string | null | undefined): SlashChoice | null {
    if (typeof entry === 'string') {
        const value = entry.trim();
        if (!value) return null;
        return { value, label: '' };
    }
    if (!entry || typeof entry !== 'object') return null;
    const e = entry as unknown as Record<string, unknown>;
    const value = String(e.value ?? e.name ?? '').trim();
    if (!value) return null;
    const label = String(e.label ?? e.desc ?? '').trim();
    return { value, label };
}

function dedupeChoices(list: Array<SlashChoice | null>): SlashChoice[] {
    const out: SlashChoice[] = [];
    const seen = new Set<string>();
    for (const entry of list || []) {
        if (!entry) continue;
        const key = toChoiceKey(entry.value ?? entry);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
    }
    return out;
}

function scoreToken(value: string, query: string): number {
    const target = toChoiceKey(value);
    const q = toChoiceKey(query);
    if (!q) return 0;
    if (!target) return -1;
    if (target === q) return 100;
    if (target.startsWith(q)) return 60;
    if (target.includes(q)) return 30;
    return -1;
}

function categoryIndex(category: string | undefined): number {
    const idx = CATEGORY_ORDER.indexOf(category || 'tools');
    return idx >= 0 ? idx : CATEGORY_ORDER.length;
}

function scoreCommandCandidate(cmd: SlashCommand, query: string): number {
    const q = toChoiceKey(query);
    if (!q) return 0;
    let score = scoreToken(cmd.name, q);
    for (const alias of (cmd.aliases || [])) {
        const aliasScore = scoreToken(alias, q);
        if (aliasScore > score) score = aliasScore - 5;
    }
    return score;
}

function scoreArgumentCandidate(item: SlashChoice, query: string): number {
    const base = scoreToken(item.value, query);
    if (base >= 0) return base;
    const labelScore = scoreToken(item.label || '', query);
    if (labelScore >= 0) return Math.max(10, labelScore - 10);
    return -1;
}

function findCommand(name: string): SlashCommand | undefined {
    const key = (name || '').toLowerCase();
    return COMMANDS.find(c => c.name === key || (c.aliases || []).includes(key));
}

// ─── helpHandler (kept here — needs COMMANDS/findCommand/sortCommands) ──

async function helpHandler(args: string[], ctx: CliCommandContext): Promise<SlashResult> {
    const iface = ctx.interface || 'cli';
    const L = ctx.locale || 'ko';
    if (args[0]) {
        const targetName = String(args[0]).replace(/^\//, '');
        const target: SlashCommand | undefined = findCommand(targetName);
        if (!target) return unknownCommand(targetName, L);
        const desc = target.descKey ? t(target.descKey, {}, L) : target.desc;
        const lines: string[] = [
            `${displayUsage(target)} — ${desc}`,
            `interfaces: ${target.interfaces.join(', ')}`,
        ];
        return { ok: true, type: 'info', text: lines.join('\n') };
    }

    const available = sortCommands(COMMANDS.filter(c =>
        c.interfaces.includes(iface) && !c.hidden
    ));
    const byCategory = new Map<string, SlashCommand[]>();
    for (const cmd of available) {
        const cat = cmd.category || 'tools';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(cmd);
    }

    const lines = [t('cmd.helpTitle', {}, L)];
    for (const cat of CATEGORY_ORDER) {
        const cmds = byCategory.get(cat);
        if (!cmds?.length) continue;
        lines.push(`\n[${(CATEGORY_LABEL as Record<string, string>)[cat] || cat}]`);
        for (const cmd of cmds) {
            const desc = cmd.descKey ? t(cmd.descKey, {}, L) : cmd.desc;
            lines.push(`- ${displayUsage(cmd)} — ${desc}`);
        }
    }
    lines.push('\n' + t('cmd.helpDetail', {}, L));
    return { ok: true, type: 'info', text: lines.join('\n') };
}

// ─── COMMANDS Registry ───────────────────────────────

export const COMMANDS: SlashCommand[] = [
    { name: 'help', aliases: ['h'], descKey: 'cmd.help.desc', tgDescKey: 'cmd.help.tg_desc', desc: 'Command list', args: '[command]', category: 'session', interfaces: ['cli', 'web', 'telegram', 'discord'], handler: helpHandler },
    { name: 'commands', aliases: ['cmd'], descKey: '', desc: 'Open command palette', category: 'session', interfaces: ['cli'], handler: async () => ({ code: 'open_palette' }) },
    { name: 'status', descKey: 'cmd.status.desc', tgDescKey: 'cmd.status.tg_desc', desc: 'Current status', category: 'session', interfaces: ['cli', 'web', 'telegram', 'discord'], handler: statusHandler },
    { name: 'clear', descKey: 'cmd.clear.desc', tgDescKey: 'cmd.clear.tg_desc', desc: 'Clear screen', category: 'session', interfaces: ['cli', 'web', 'telegram', 'discord'], handler: clearHandler },
    { name: 'compact', descKey: 'cmd.compact.desc', tgDescKey: 'cmd.compact.tg_desc', desc: 'Compact conversation context', args: '[instructions]', category: 'session', interfaces: ['cli', 'web', 'telegram', 'discord'], handler: compactHandler },
    { name: 'reset', descKey: 'cmd.reset.desc', desc: 'Full reset', args: '[confirm]', category: 'session', interfaces: ['cli', 'web', 'telegram', 'discord'], handler: resetHandler },
    { name: 'model', descKey: 'cmd.model.desc', tgDescKey: 'cmd.model.tg_desc', desc: 'View/change model', args: '[name]', category: 'model', interfaces: ['cli', 'web', 'telegram', 'discord'], getArgumentCompletions: modelArgumentCompletions, handler: modelHandler },
    { name: 'cli', descKey: 'cmd.cli.desc', tgDescKey: 'cmd.cli.tg_desc', desc: 'View/change CLI', args: '[name]', category: 'model', interfaces: ['cli', 'web', 'telegram', 'discord'], getArgumentCompletions: cliArgumentCompletions, handler: cliHandler },
    { name: 'fallback', descKey: 'cmd.fallback.desc', tgDescKey: 'cmd.fallback.tg_desc', desc: 'Set fallback order', args: '[cli1 cli2...|off]', category: 'model', interfaces: ['cli', 'web', 'telegram', 'discord'], getArgumentCompletions: fallbackArgumentCompletions, handler: fallbackHandler },
    { name: 'forward', descKey: 'cmd.forward.desc', tgDescKey: 'cmd.forward.tg_desc', desc: 'Toggle forwarding (on/off)', args: '[on|off]', category: 'model', interfaces: ['cli', 'web', 'telegram', 'discord'], handler: forwardHandler },
    { name: 'thought', desc: 'Toggle Gemini thought visibility', args: '[on|off]', category: 'model', interfaces: ['cli', 'web', 'telegram', 'discord'], handler: thoughtHandler },
    { name: 'flush', descKey: 'cmd.flush.desc', tgDescKey: 'cmd.flush.tg_desc', desc: 'Set flush model', args: '[cli] [model] | off', category: 'model', interfaces: ['cli', 'web', 'telegram', 'discord'], getArgumentCompletions: flushArgumentCompletions, handler: flushHandler },
    { name: 'version', descKey: 'cmd.version.desc', tgDescKey: 'cmd.version.tg_desc', desc: 'Version/CLI status', category: 'cli', interfaces: ['cli', 'web', 'telegram', 'discord'], handler: versionHandler },
    { name: 'skill', descKey: 'cmd.skill.desc', tgDescKey: 'cmd.skill.tg_desc', desc: 'Skill list/reset', args: '[list|reset]', category: 'tools', interfaces: ['cli', 'web', 'telegram', 'discord'], getArgumentCompletions: skillArgumentCompletions, handler: skillHandler },
    { name: 'employee', descKey: 'cmd.employee.desc', desc: 'Reset employees', args: 'reset', category: 'tools', interfaces: ['cli', 'web', 'telegram', 'discord'], getArgumentCompletions: employeeArgumentCompletions, handler: employeeHandler },
    { name: 'mcp', descKey: 'cmd.mcp.desc', desc: 'MCP list/sync/install', args: '[sync|install]', category: 'tools', interfaces: ['cli', 'web', 'telegram', 'discord'], handler: mcpHandler },
    { name: 'memory', descKey: 'cmd.memory.desc', desc: 'Memory search/list', args: '[query]', category: 'tools', interfaces: ['cli', 'web', 'telegram', 'discord'], handler: memoryHandler },
    { name: 'browser', descKey: 'cmd.browser.desc', tgDescKey: 'cmd.browser.tg_desc', desc: 'Browser status/tabs', args: '[status|tabs]', category: 'tools', interfaces: ['cli', 'web', 'telegram', 'discord'], getArgumentCompletions: browserArgumentCompletions, handler: browserHandler },
    { name: 'prompt', descKey: 'cmd.prompt.desc', desc: 'View system prompt', category: 'tools', interfaces: ['cli', 'web', 'telegram', 'discord'], handler: promptHandler },
    { name: 'quit', aliases: ['q', 'exit'], descKey: 'cmd.quit.desc', desc: 'Quit process', category: 'cli', interfaces: ['cli'], handler: quitHandler },
    { name: 'file', descKey: 'cmd.file.desc', desc: 'Attach file', args: '<path> [caption]', category: 'cli', interfaces: ['cli'], hidden: true, handler: fileHandler },
    { name: 'steer', descKey: 'cmd.steer.desc', tgDescKey: 'cmd.steer.tg_desc', desc: 'Interrupt agent and redirect', args: '<prompt>', category: 'session', interfaces: ['web', 'telegram', 'discord'], handler: steerHandler },
    { name: 'ide', descKey: 'cmd.ide.desc', desc: 'IDE diff view', args: '[pop|on|off]', category: 'tools', interfaces: ['cli'], handler: ideHandler },
    { name: 'orchestrate', aliases: ['pabcd'], descKey: '', desc: 'Enter PABCD orchestration', args: '[P|A|B|C|D|status|reset] [--force]', category: 'tools', interfaces: ['cli', 'web', 'telegram', 'discord'], handler: orchestrateHandler },
];

// ─── Dispatch ────────────────────────────────────────

export function parseCommand(text: string): ParsedSlashCommand {
    if (typeof text !== 'string' || !text.startsWith('/')) return null;
    const body = text.slice(1).trim();
    if (!body) {
        const help = findCommand('help');
        if (!help) return null;
        return { type: 'known', cmd: help, args: [], name: 'help' };
    }
    // File paths like /users/junny/... or /tmp/foo — not commands
    const firstToken = body.split(/\s+/)[0] || '';
    if (firstToken.includes('/') || firstToken.includes('\\')) return null;
    const parts = body.split(/\s+/);
    const name = (parts.shift() || '').toLowerCase();
    const cmd = findCommand(name);
    if (!cmd) return { type: 'unknown', name, args: parts };
    return { type: 'known', cmd, args: parts, name };
}

export async function executeCommand(parsed: ParsedSlashCommand, ctx: { interface?: string; locale?: string; [k: string]: unknown }): Promise<SlashResult | null> {
    const L = ctx?.locale || 'ko';
    if (!parsed) return null;
    if (parsed.type === 'unknown') return unknownCommand(parsed.name, L);
    const iface = ctx.interface || 'cli';
    if (!parsed.cmd.interfaces.includes(iface)) {
        return unsupportedCommand(parsed.cmd, iface, L);
    }
    // Readonly enforcement: if command is readonly on this interface and args are supplied (write attempt), block
    if (iface && parsed.args?.length > 0) {
        const { getCommandCatalog, CAPABILITY } = await import('../command-contract/catalog.js');
        const catalogCmd = getCommandCatalog().find((c: SlashCommand) => c.name === parsed.cmd.name);
        const cap = (catalogCmd as { capability?: Record<string, string> } | undefined)?.capability;
        if (cap?.[iface] === CAPABILITY.readonly) {
            return {
                ok: false,
                code: 'readonly',
                text: t('cmd.unsupported', { name: parsed.cmd.name, iface }, L),
            };
        }
    }
    try {
        const handler = parsed.cmd.handler as (args: string[], ctx: CliCommandContext) => unknown;
        return normalizeResult(await handler(parsed.args || [], ctx as unknown as CliCommandContext));
    } catch (err: unknown) {
        const msg = (err as Error)?.message || String(err);
        return {
            ok: false,
            code: 'command_error',
            text: t('cmd.error', { name: parsed.cmd.name, msg }, L),
        };
    }
}

// ─── Completions ─────────────────────────────────────

export function getCompletions(partial: string, iface: string = 'cli'): string[] {
    const prefix = (partial || '').startsWith('/')
        ? (partial || '').toLowerCase()
        : '/' + String(partial || '').toLowerCase();
    return getCompletionItems(prefix, iface)
        .map(c => `/${c.name}`);
}

export interface CommandCompletionItem {
    kind: 'command';
    name: string;
    desc: string;
    args: string;
    category: string;
    insertText: string;
}

export function getCompletionItems(partial: string, iface: string = 'cli', locale: string = 'ko'): CommandCompletionItem[] {
    const query = String(partial || '').replace(/^\//, '').trim().toLowerCase();
    return COMMANDS
        .filter(c => c.interfaces.includes(iface) && !c.hidden)
        .map(cmd => ({ cmd, score: scoreCommandCandidate(cmd, query) }))
        .filter(({ score }) => !query || score >= 0)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const catDiff = categoryIndex(a.cmd.category) - categoryIndex(b.cmd.category);
            if (catDiff !== 0) return catDiff;
            return a.cmd.name.localeCompare(b.cmd.name);
        })
        .map(({ cmd }) => ({
            kind: 'command' as const,
            name: cmd.name,
            desc: (cmd.descKey ? t(cmd.descKey, {}, locale) : cmd.desc) || '',
            args: cmd.args || '',
            category: cmd.category || 'tools',
            insertText: `/${cmd.name}${cmd.args ? ' ' : ''}`,
        }));
}

export interface ArgumentCompletionItem {
    kind: 'argument';
    name: string;
    desc: string;
    args: string;
    category: string;
    command: string;
    commandDesc: string;
    insertText: string;
}

export function getArgumentCompletionItems(
    commandName: string,
    partial: string = '',
    iface: string = 'cli',
    argv: string[] = [],
    ctx: { settings?: { perCli?: Record<string, unknown>; cli?: string }; locale?: string } = {},
): ArgumentCompletionItem[] {
    const cmd = findCommand(commandName);
    if (!cmd || cmd.hidden) return [];
    if (!cmd.interfaces.includes(iface)) return [];
    if (typeof cmd.getArgumentCompletions !== 'function') return [];

    let candidates: SlashChoice[];
    try {
        const result = cmd.getArgumentCompletions(ctx as CompletionCtx, argv, partial);
        candidates = (Array.isArray(result) ? result : []) as SlashChoice[];
    } catch (err: unknown) {
        if (process.env.DEBUG) console.warn('[commands:argComplete]', (err as Error).message);
        return [];
    }
    const normalized = dedupeChoices(candidates.map(normalizeArgumentCandidate));
    const query = String(partial || '').trim().toLowerCase();

    return normalized
        .map((entry, idx) => ({ entry, idx, score: scoreArgumentCandidate(entry, query) }))
        .filter(({ score }) => !query || score >= 0)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (a.idx !== b.idx) return a.idx - b.idx;
            return a.entry.value.localeCompare(b.entry.value);
        })
        .map(({ entry }) => ({
            kind: 'argument' as const,
            name: entry.value,
            desc: entry.label || '',
            args: '',
            category: cmd.category || 'tools',
            command: cmd.name,
            commandDesc: cmd.desc || '',
            insertText: `/${cmd.name} ${entry.value}`,
        }));
}

// ─── Slash Commands Registry + Dispatcher ───────────────────────────────

import { CLI_KEYS, buildModelChoicesByCli } from './cli-registry.js';
import { t } from './i18n.js';

const CATEGORY_ORDER = ['session', 'model', 'tools', 'cli'];
const CATEGORY_LABEL = {
    session: 'Session',
    model: 'Model',
    tools: 'Tools',
    cli: 'CLI',
};
const DEFAULT_CLI_CHOICES = [...CLI_KEYS];
const MODEL_CHOICES_BY_CLI = buildModelChoicesByCli();

function sortCommands(list) {
    return [...list].sort((a, b) => {
        const ai = CATEGORY_ORDER.indexOf(a.category || 'tools');
        const bi = CATEGORY_ORDER.indexOf(b.category || 'tools');
        if (ai !== bi) return ai - bi;
        return a.name.localeCompare(b.name);
    });
}

function displayUsage(cmd) {
    return `/${cmd.name}${cmd.args ? ` ${cmd.args}` : ''}`;
}

function toChoiceKey(value) {
    return String(value || '').trim().toLowerCase();
}

function dedupeChoices(list) {
    const out = [];
    const seen = new Set();
    for (const entry of list || []) {
        const key = toChoiceKey(entry?.value ?? entry);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
    }
    return out;
}

function normalizeArgumentCandidate(entry) {
    if (typeof entry === 'string') {
        const value = entry.trim();
        if (!value) return null;
        return { value, label: '' };
    }
    if (!entry || typeof entry !== 'object') return null;
    const value = String(entry.value ?? entry.name ?? '').trim();
    if (!value) return null;
    const label = String(entry.label ?? entry.desc ?? '').trim();
    return { value, label };
}

function scoreToken(value, query) {
    const target = toChoiceKey(value);
    const q = toChoiceKey(query);
    if (!q) return 0;
    if (!target) return -1;
    if (target === q) return 100;
    if (target.startsWith(q)) return 60;
    if (target.includes(q)) return 30;
    return -1;
}

function categoryIndex(category) {
    const idx = CATEGORY_ORDER.indexOf(category || 'tools');
    return idx >= 0 ? idx : CATEGORY_ORDER.length;
}

function scoreCommandCandidate(cmd, query) {
    const q = toChoiceKey(query);
    if (!q) return 0;

    let score = scoreToken(cmd.name, q);
    for (const alias of (cmd.aliases || [])) {
        const aliasScore = scoreToken(alias, q);
        if (aliasScore > score) score = aliasScore - 5; // alias는 name보다 낮게 우선
    }
    return score;
}

function scoreArgumentCandidate(item, query) {
    const base = scoreToken(item.value, query);
    if (base >= 0) return base;
    const labelScore = scoreToken(item.label, query);
    if (labelScore >= 0) return Math.max(10, labelScore - 10);
    return -1;
}

function getCliChoicesFromContext(ctx) {
    const keys = Object.keys(ctx?.settings?.perCli || {});
    return keys.length ? keys : DEFAULT_CLI_CHOICES;
}

function getModelChoicesFromContext(ctx) {
    const fromCatalog = Object.values(MODEL_CHOICES_BY_CLI).flat();
    const fromSettings = Object.values(ctx?.settings?.perCli || {})
        .map(v => v?.model)
        .filter(Boolean);
    const activeCli = ctx?.settings?.cli || '';
    const currentModel = ctx?.settings?.perCli?.[activeCli]?.model;
    return dedupeChoices([...fromCatalog, ...fromSettings, ...(currentModel ? [currentModel] : [])]);
}

function modelArgumentCompletions(ctx) {
    // CLI별 라벨 역매핑: model → CLI name
    const cliByModel = new Map();
    for (const [cli, models] of Object.entries(MODEL_CHOICES_BY_CLI)) {
        for (const m of models) cliByModel.set(toChoiceKey(m), cli);
    }

    return getModelChoicesFromContext(ctx)
        .map(value => ({
            value,
            label: cliByModel.get(toChoiceKey(value)) || 'custom',
        }));
}

function cliArgumentCompletions(ctx) {
    return getCliChoicesFromContext(ctx)
        .map(value => ({ value, label: 'cli' }));
}

function skillArgumentCompletions(ctx) {
    const L = ctx?.locale || 'ko';
    return [{ value: 'list', label: t('cmd.arg.skillList', {}, L) }, { value: 'reset', label: t('cmd.arg.skillReset', {}, L) }];
}

function employeeArgumentCompletions(ctx) {
    const L = ctx?.locale || 'ko';
    return [{ value: 'reset', label: t('cmd.arg.employeeReset', {}, L) }];
}

function browserArgumentCompletions(ctx) {
    const L = ctx?.locale || 'ko';
    return [{ value: 'status', label: t('cmd.arg.browserStatus', {}, L) }, { value: 'tabs', label: t('cmd.arg.browserTabs', {}, L) }];
}

function findCommand(name) {
    const key = (name || '').toLowerCase();
    return COMMANDS.find(c => c.name === key || (c.aliases || []).includes(key));
}

async function safeCall(fn, fallback = null) {
    if (typeof fn !== 'function') return fallback;
    try {
        return await fn();
    } catch (err) {
        if (process.env.DEBUG) console.warn('[commands:safeCall]', err.message);
        return fallback;
    }
}

function formatDuration(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function normalizeResult(result) {
    if (!result) return { ok: true, type: 'success', text: '' };
    if (typeof result === 'string') return { ok: true, type: 'info', text: result };
    if (typeof result === 'object') {
        const ok = result.ok !== false;
        const type = result.type || (ok ? 'success' : 'error');
        return { ok, type, ...result };
    }
    return { ok: true, type: 'info', text: String(result) };
}

function unknownCommand(name, locale = 'ko') {
    return {
        ok: false,
        type: 'error',
        code: 'unknown_command',
        text: t('cmd.unknown', { name }, locale),
    };
}

function unsupportedCommand(cmd, iface, locale = 'ko') {
    return {
        ok: false,
        type: 'error',
        code: 'unsupported_interface',
        text: t('cmd.unsupported', { name: cmd.name, iface }, locale),
    };
}

async function helpHandler(args, ctx) {
    const iface = ctx.interface || 'cli';
    const L = ctx.locale || 'ko';
    if (args[0]) {
        const targetName = String(args[0]).replace(/^\//, '');
        const target = findCommand(targetName);
        if (!target) return unknownCommand(targetName, L);
        const desc = target.descKey ? t(target.descKey, {}, L) : target.desc;
        const lines = [
            `${displayUsage(target)} — ${desc}`,
            `interfaces: ${target.interfaces.join(', ')}`,
        ];
        return { ok: true, type: 'info', text: lines.join('\n') };
    }

    const available = sortCommands(COMMANDS.filter(c =>
        c.interfaces.includes(iface) && !c.hidden
    ));
    const byCategory = new Map();
    for (const cmd of available) {
        const cat = cmd.category || 'tools';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(cmd);
    }

    const lines = [t('cmd.helpTitle', {}, L)];
    for (const cat of CATEGORY_ORDER) {
        const cmds = byCategory.get(cat);
        if (!cmds?.length) continue;
        lines.push(`\n[${CATEGORY_LABEL[cat] || cat}]`);
        for (const cmd of cmds) {
            const desc = cmd.descKey ? t(cmd.descKey, {}, L) : cmd.desc;
            lines.push(`- ${displayUsage(cmd)} — ${desc}`);
        }
    }
    lines.push('\n' + t('cmd.helpDetail', {}, L));
    return { ok: true, type: 'info', text: lines.join('\n') };
}

async function statusHandler(_args, ctx) {
    const [settings, session, runtime, skills] = await Promise.all([
        safeCall(ctx.getSettings, null),
        safeCall(ctx.getSession, null),
        safeCall(ctx.getRuntime, null),
        safeCall(ctx.getSkills, []),
    ]);

    const cli = settings?.cli || session?.active_cli || 'unknown';
    const model = settings?.perCli?.[cli]?.model || session?.model || 'default';
    const effort = settings?.perCli?.[cli]?.effort || session?.effort || '-';
    const agent = runtime?.activeAgent === true
        ? '● running'
        : runtime?.activeAgent === false ? '○ idle' : '-';
    const queuePending = runtime?.queuePending ?? '-';
    const uptime = formatDuration(runtime?.uptimeSec);
    const activeSkills = Array.isArray(skills) ? skills.filter(s => s.enabled).length : '-';
    const refSkills = Array.isArray(skills) ? skills.filter(s => !s.enabled).length : '-';

    const fb = settings?.fallbackOrder || [];

    return {
        ok: true,
        type: 'info',
        text: [
            `🦞 cli-claw v${ctx.version || 'unknown'}`,
            `CLI:      ${cli}`,
            `Model:    ${model}`,
            `Effort:   ${effort || '-'}`,
            ...(fb.length ? [`Fallback: ${fb.join(' → ')}`] : []),
            `Uptime:   ${uptime}`,
            `Agent:    ${agent}`,
            `Queue:    ${queuePending}`,
            `Skills:   ${activeSkills} active, ${refSkills} ref`,
        ].join('\n'),
    };
}

async function modelHandler(args, ctx) {
    const L = ctx.locale || 'ko';
    const settings = await safeCall(ctx.getSettings, null);
    if (!settings) return { ok: false, text: t('cmd.settingsLoadFail', {}, L) };

    const activeCli = settings.cli || 'claude';
    const current = settings.perCli?.[activeCli]?.model || 'default';

    if (!args.length) {
        return { ok: true, text: t('cmd.model.current', { cli: activeCli, model: current }, L) };
    }

    const nextModel = args.join(' ').trim();
    if (!nextModel || nextModel.length > 200 || /[\r\n]/.test(nextModel)) {
        return { ok: false, text: t('cmd.model.invalid', {}, L) };
    }

    const nextPerCli = {
        ...(settings.perCli || {}),
        [activeCli]: {
            ...(settings.perCli?.[activeCli] || {}),
            model: nextModel,
        },
    };
    const updateResult = await ctx.updateSettings({ perCli: nextPerCli });
    if (updateResult?.ok === false) return updateResult;
    return {
        ok: true,
        text: t('cmd.model.changed', { model: nextModel }, L),
    };
}

async function cliHandler(args, ctx) {
    const L = ctx.locale || 'ko';
    const settings = await safeCall(ctx.getSettings, null);
    if (!settings) return { ok: false, text: t('cmd.settingsLoadFail', {}, L) };

    const allowed = Object.keys(settings.perCli || {});
    const fallbackAllowed = allowed.length ? allowed : DEFAULT_CLI_CHOICES;
    const current = settings.cli || 'claude';

    if (!args.length) {
        return {
            ok: true,
            text: t('cmd.cli.current', { cli: current, available: fallbackAllowed.join(', ') }, L),
        };
    }

    const nextCli = args[0].toLowerCase();
    if (!fallbackAllowed.includes(nextCli)) {
        return {
            ok: false,
            text: t('cmd.cli.unknown', { cli: nextCli, available: fallbackAllowed.join(', ') }, L),
        };
    }

    if (nextCli === current) {
        return { ok: true, text: t('cmd.cli.already', { cli: nextCli }, L) };
    }

    const updateResult = await ctx.updateSettings({ cli: nextCli });
    if (updateResult?.ok === false) return updateResult;
    return { ok: true, text: t('cmd.cli.changed', { from: current, to: nextCli }, L) };
}

async function skillHandler(args, ctx) {
    const L = ctx.locale || 'ko';
    const sub = (args[0] || 'list').toLowerCase();
    if (sub === 'list') {
        const skills = await safeCall(ctx.getSkills, []);
        if (!Array.isArray(skills)) return { ok: false, text: t('cmd.skill.loadFail', {}, L) };
        const active = skills.filter(s => s.enabled).length;
        const ref = skills.filter(s => !s.enabled).length;
        return { ok: true, text: `🧰 Skills: ${active} active, ${ref} ref` };
    }
    if (sub === 'reset') {
        if (typeof ctx.resetSkills !== 'function') {
            return { ok: false, text: t('cmd.skill.resetUnavailable', {}, L) };
        }
        await ctx.resetSkills();
        return { ok: true, text: t('cmd.skill.resetDone', {}, L) };
    }
    return { ok: false, text: 'Usage: /skill [list|reset]' };
}

async function employeeHandler(args, ctx) {
    const L = ctx.locale || 'ko';
    const sub = (args[0] || '').toLowerCase();
    if (sub !== 'reset') {
        return { ok: false, text: 'Usage: /employee reset' };
    }
    if (typeof ctx.resetEmployees !== 'function') {
        return { ok: false, text: t('cmd.employee.resetUnavailable', {}, L) };
    }
    const result = await ctx.resetEmployees();
    const seeded = Number.isFinite(result?.seeded) ? result.seeded : '?';
    return { ok: true, text: t('cmd.employee.resetDone', { count: seeded }, L) };
}

async function clearHandler(_args, ctx) {
    const L = ctx.locale || 'ko';
    if ((ctx.interface || 'cli') === 'telegram') {
        return { ok: true, text: t('cmd.clear.telegram', {}, L) };
    }
    return {
        ok: true,
        code: 'clear_screen',
        text: t('cmd.clear.done', {}, L),
    };
}

async function resetHandler(args, ctx) {
    const L = ctx.locale || 'ko';
    if ((args[0] || '').toLowerCase() !== 'confirm') {
        return {
            ok: false,
            text: t('cmd.reset.confirm', {}, L),
        };
    }
    const results = [];
    if (typeof ctx.resetSkills === 'function') {
        await ctx.resetSkills();
        results.push(t('cmd.reset.skills', {}, L));
    }
    if (typeof ctx.resetEmployees === 'function') {
        await ctx.resetEmployees();
        results.push(t('cmd.reset.employees', {}, L));
    }
    if (typeof ctx.syncMcp === 'function') {
        await ctx.syncMcp();
        results.push('MCP');
    }
    if (typeof ctx.clearSession === 'function') {
        await ctx.clearSession();
        results.push(t('cmd.reset.sessions', {}, L));
    }
    if (!results.length) {
        return { ok: false, text: t('cmd.reset.unavailable', {}, L) };
    }
    return { ok: true, text: t('cmd.reset.done', { items: results.join(', ') }, L) };
}

async function versionHandler(_args, ctx) {
    const status = await safeCall(ctx.getCliStatus, null);
    const lines = [`cli-claw v${ctx.version || 'unknown'}`];
    if (status && typeof status === 'object') {
        for (const key of DEFAULT_CLI_CHOICES) {
            if (!status[key]) continue;
            const entry = status[key];
            const icon = entry.available ? '✅' : '❌';
            lines.push(`${key}: ${icon}${entry.path ? ` ${entry.path}` : ''}`);
        }
    }
    return { ok: true, text: lines.join('\n') };
}

async function mcpHandler(args, ctx) {
    const L = ctx.locale || 'ko';
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'sync') {
        const d = await ctx.syncMcp();
        const keys = Object.keys(d?.results || {});
        return { ok: true, text: t('cmd.mcp.syncDone', { count: keys.length }, L) };
    }
    if (sub === 'install') {
        const d = await ctx.installMcp();
        const keys = Object.keys(d?.results || {});
        return { ok: true, text: t('cmd.mcp.installDone', { count: keys.length }, L) };
    }
    const d = await ctx.getMcp();
    const names = Object.keys(d?.servers || {});
    return {
        ok: true,
        text: `MCP servers (${names.length}): ${names.join(', ') || '(none)'}\n/mcp sync\n/mcp install`,
    };
}

async function memoryHandler(args, ctx) {
    const L = ctx.locale || 'ko';
    if (!args.length || (args.length === 1 && args[0].toLowerCase() === 'list')) {
        const files = await ctx.listMemory();
        if (!files?.length) return { ok: true, text: t('cmd.memory.empty', {}, L) };
        const lines = files.slice(0, 20).map(f => `- ${f.path} (${f.size}b)`);
        return { ok: true, text: `🧠 memory files (${files.length})\n${lines.join('\n')}` };
    }
    const query = args.join(' ').trim();
    const result = await ctx.searchMemory(query);
    const text = String(result || '(no results)');
    const MAX = 3000;
    return { ok: true, text: text.length > MAX ? text.slice(0, MAX) + '\n...(truncated)' : text };
}

async function browserHandler(args, ctx) {
    const L = ctx.locale || 'ko';
    const sub = (args[0] || 'status').toLowerCase();
    if (sub === 'tabs') {
        const d = await ctx.getBrowserTabs();
        const tabs = d?.tabs || [];
        if (!tabs.length) return { ok: true, text: t('cmd.browser.noTabs', {}, L) };
        const lines = tabs.slice(0, 10).map((tab, i) => `${i + 1}. ${tab.title || '(untitled)'}\n   ${tab.url || ''}`);
        return { ok: true, text: lines.join('\n') };
    }
    if (sub !== 'status') return { ok: false, text: 'Usage: /browser [status|tabs]' };
    const d = await ctx.getBrowserStatus();
    const running = d?.running ? 'running' : 'stopped';
    const tabCount = d?.tabs?.length ?? d?.tabCount ?? '-';
    return { ok: true, text: `🌐 Browser: ${running}\nTabs: ${tabCount}\nCDP: ${d?.cdpUrl || '-'}` };
}

async function promptHandler(_args, ctx) {
    const d = await ctx.getPrompt();
    const content = d?.content || '';
    if (!content.trim()) return { ok: true, text: '(empty prompt)' };
    const lines = content.trim().split('\n');
    const preview = lines.slice(0, 20).join('\n');
    const suffix = lines.length > 20 ? '\n...(truncated)' : '';
    return { ok: true, text: `${preview}${suffix}` };
}

async function quitHandler() {
    return { ok: true, code: 'exit', text: 'Bye!' };
}

async function fileHandler() {
    return { ok: false, text: 'Usage: /file <path> [caption]' };
}

async function fallbackHandler(args, ctx) {
    const L = ctx.locale || 'ko';
    const settings = await safeCall(ctx.getSettings, null);
    if (!settings) return { ok: false, text: t('cmd.settingsLoadFail', {}, L) };
    const available = Object.keys(settings.perCli || {});

    if (!args.length) {
        const fb = settings.fallbackOrder || [];
        return {
            ok: true, type: 'info',
            text: fb.length
                ? `⚡ Fallback: ${fb.join(' → ')}`
                : t('cmd.fallback.inactive', { available: available.join(', ') }, L),
        };
    }

    if (args[0] === 'off' || args[0] === 'none') {
        const r = await ctx.updateSettings({ fallbackOrder: [] });
        if (r?.ok === false) return r;
        return { ok: true, text: t('cmd.fallback.off', {}, L) };
    }

    const order = args.filter(a => available.includes(a.toLowerCase())).map(a => a.toLowerCase());
    if (!order.length) {
        return { ok: false, text: t('cmd.fallback.invalidCli', { available: available.join(', ') }, L) };
    }

    const r = await ctx.updateSettings({ fallbackOrder: order });
    if (r?.ok === false) return r;
    return { ok: true, text: t('cmd.fallback.set', { order: order.join(' → ') }, L) };
}

function fallbackArgumentCompletions(ctx) {
    const L = ctx?.locale || 'ko';
    const clis = Object.keys(ctx?.settings?.perCli || {});
    return [
        ...clis.map(c => ({ value: c, label: 'cli' })),
        { value: 'off', label: t('cmd.arg.fallbackOff', {}, L) },
    ];
}

export const COMMANDS = [
    { name: 'help', aliases: ['h'], descKey: 'cmd.help.desc', desc: 'Command list', args: '[command]', category: 'session', interfaces: ['cli', 'web', 'telegram'], handler: helpHandler },
    { name: 'status', descKey: 'cmd.status.desc', desc: 'Current status', category: 'session', interfaces: ['cli', 'web', 'telegram'], handler: statusHandler },
    { name: 'clear', descKey: 'cmd.clear.desc', desc: 'Clear screen', category: 'session', interfaces: ['cli', 'web', 'telegram'], handler: clearHandler },
    { name: 'reset', descKey: 'cmd.reset.desc', desc: 'Full reset', args: '[confirm]', category: 'session', interfaces: ['cli', 'web'], handler: resetHandler },
    { name: 'model', descKey: 'cmd.model.desc', desc: 'View/change model', args: '[name]', category: 'model', interfaces: ['cli', 'web', 'telegram'], getArgumentCompletions: modelArgumentCompletions, handler: modelHandler },
    { name: 'cli', descKey: 'cmd.cli.desc', desc: 'View/change CLI', args: '[name]', category: 'model', interfaces: ['cli', 'web', 'telegram'], getArgumentCompletions: cliArgumentCompletions, handler: cliHandler },
    { name: 'fallback', descKey: 'cmd.fallback.desc', desc: 'Set fallback order', args: '[cli1 cli2...|off]', category: 'model', interfaces: ['cli', 'web', 'telegram'], getArgumentCompletions: fallbackArgumentCompletions, handler: fallbackHandler },
    { name: 'version', descKey: 'cmd.version.desc', desc: 'Version/CLI status', category: 'cli', interfaces: ['cli', 'web', 'telegram'], handler: versionHandler },
    { name: 'skill', descKey: 'cmd.skill.desc', desc: 'Skill list/reset', args: '[list|reset]', category: 'tools', interfaces: ['cli', 'web', 'telegram'], getArgumentCompletions: skillArgumentCompletions, handler: skillHandler },
    { name: 'employee', descKey: 'cmd.employee.desc', desc: 'Reset employees', args: 'reset', category: 'tools', interfaces: ['cli', 'web'], getArgumentCompletions: employeeArgumentCompletions, handler: employeeHandler },
    { name: 'mcp', descKey: 'cmd.mcp.desc', desc: 'MCP list/sync/install', args: '[sync|install]', category: 'tools', interfaces: ['cli', 'web'], handler: mcpHandler },
    { name: 'memory', descKey: 'cmd.memory.desc', desc: 'Memory search/list', args: '[query]', category: 'tools', interfaces: ['cli'], handler: memoryHandler },
    { name: 'browser', descKey: 'cmd.browser.desc', desc: 'Browser status/tabs', args: '[status|tabs]', category: 'tools', interfaces: ['cli', 'web', 'telegram'], getArgumentCompletions: browserArgumentCompletions, handler: browserHandler },
    { name: 'prompt', descKey: 'cmd.prompt.desc', desc: 'View system prompt', category: 'tools', interfaces: ['cli', 'web'], handler: promptHandler },
    { name: 'quit', aliases: ['q', 'exit'], descKey: 'cmd.quit.desc', desc: 'Quit process', category: 'cli', interfaces: ['cli'], handler: quitHandler },
    { name: 'file', descKey: 'cmd.file.desc', desc: 'Attach file', args: '<path> [caption]', category: 'cli', interfaces: ['cli'], hidden: true, handler: fileHandler },
];

export function parseCommand(text) {
    if (typeof text !== 'string' || !text.startsWith('/')) return null;
    const body = text.slice(1).trim();
    if (!body) {
        const help = findCommand('help');
        return { type: 'known', cmd: help, args: [], name: 'help' };
    }
    const parts = body.split(/\s+/);
    const name = (parts.shift() || '').toLowerCase();
    const cmd = findCommand(name);
    if (!cmd) return { type: 'unknown', name, args: parts };
    return { type: 'known', cmd, args: parts, name };
}

export async function executeCommand(parsed, ctx) {
    const L = ctx?.locale || 'ko';
    if (!parsed) return null;
    if (parsed.type === 'unknown') return unknownCommand(parsed.name, L);
    if (!parsed.cmd.interfaces.includes(ctx.interface || 'cli')) {
        return unsupportedCommand(parsed.cmd, ctx.interface || 'cli', L);
    }
    try {
        return normalizeResult(await parsed.cmd.handler(parsed.args || [], ctx));
    } catch (err) {
        const msg = err?.message || String(err);
        return {
            ok: false,
            code: 'command_error',
            text: t('cmd.error', { name: parsed.cmd.name, msg }, L),
        };
    }
}

export function getCompletions(partial, iface = 'cli') {
    const prefix = (partial || '').startsWith('/')
        ? (partial || '').toLowerCase()
        : '/' + String(partial || '').toLowerCase();
    return getCompletionItems(prefix, iface)
        .map(c => `/${c.name}`);
}

export function getCompletionItems(partial, iface = 'cli', locale = 'ko') {
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
            kind: 'command',
            name: cmd.name,
            desc: cmd.descKey ? t(cmd.descKey, {}, locale) : cmd.desc,
            args: cmd.args || '',
            category: cmd.category || 'tools',
            insertText: `/${cmd.name}${cmd.args ? ' ' : ''}`,
        }));
}

export function getArgumentCompletionItems(commandName, partial = '', iface = 'cli', argv = [], ctx = {}) {
    const cmd = findCommand(commandName);
    if (!cmd || cmd.hidden) return [];
    if (!cmd.interfaces.includes(iface)) return [];
    if (typeof cmd.getArgumentCompletions !== 'function') return [];

    let candidates;
    try {
        candidates = cmd.getArgumentCompletions(ctx, argv, partial) || [];
    } catch (err) {
        if (process.env.DEBUG) console.warn('[commands:argComplete]', err.message);
        return [];
    }
    const normalized = dedupeChoices(candidates.map(normalizeArgumentCandidate).filter(Boolean));
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
            kind: 'argument',
            name: entry.value,
            desc: entry.label,
            args: '',
            category: cmd.category || 'tools',
            command: cmd.name,
            commandDesc: cmd.desc,
            insertText: `/${cmd.name} ${entry.value}`,
        }));
}

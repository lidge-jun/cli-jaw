import { posix, win32 } from 'node:path';
import { redactOutboundText } from '../messaging/redact.js';
import { projectSlackFilePath, projectSlackToolFile, sanitizeSlackFileLabel } from './progress-files.js';

export interface SlackActivityDetail {
    purpose?: string;
    tool?: string;
    action?: 'Read' | 'Write' | 'Edit' | 'Search' | 'List' | 'Test' | 'Build' | 'Run' | 'Git' | 'HTTP';
    runner?: string;
    targets?: string[];
    query?: string;
    qualifier?: string;
}
const actions = new Set(['Read', 'Write', 'Edit', 'Search', 'List', 'Test', 'Build', 'Run', 'Git', 'HTTP']);
const shells = new Set(['bash', 'shell', 'exec_command']);
const scripts = new Set(['node', 'nodejs', 'tsx', 'python', 'python3', 'bash', 'sh']);
const tasks = new Set(['test', 'build', 'typecheck', 'lint', 'check']);
const gitTasks = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files']);
const MAX_COMMAND = 8192;
const inlineFlags = new Set(['-c', '-lc', '-cl', '-e', '--eval', '-p', '--print', '-s', '-']);
const interpreterFlags = new Set(['--test', '--experimental-test-module-mocks', '--no-warnings', '--experimental-strip-types']);
function hasInterpreterPrefix(words: string[]): boolean {
    const invocation = withoutAssignments(words);
    if (!scripts.has(executable(invocation[0]) ?? '')) return false;
    for (const arg of invocation.slice(1)) {
        if (inlineFlags.has(arg)) return true;
        if (arg.startsWith('-')) { if (!interpreterFlags.has(arg)) return false; }
        else return Boolean(projectSlackFilePath(arg));
    }
    return false;
}
function clip(value: string, limit: number): string {
    let result = '';
    for (const char of value) { if (result.length + char.length > limit) break; result += char; }
    return result;
}
function safeText(value: unknown, max: number, identifierContext = false): string | undefined {
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_COMMAND
        || /[\p{Cc}\p{Cf}\p{Cs}<>`*~|&$\\\[\]{}]/u.test(value)
        || /(?:[a-z][a-z\d+.-]*:\/\/|www\.|@|(?:^|[\s("':=])(?:\/|[a-z]:[\\/]|~\/))/i.test(value)
        || /(?:xox[baprs]-|xapp-|sk-|gh[pousr]_|github_pat_|bearer\s|authorization|password|api[_ -]?key|secret|token\s*[:=])/i.test(value)
        || (!identifierContext && /(?:^|\s)_[^_]+_(?:$|\s)|__/.test(value))
        || /\b[\w.-]+\s*=/.test(value) || /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(value)
        || redactOutboundText(value) !== value) return undefined;
    return clip(value.trim().replace(/\s+/g, ' '), max);
}
function identifier(value: unknown): string | undefined {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/.test(value) && safeText(value, 48, true) ? value : undefined;
}
function qualifier(value: unknown): string | undefined {
    return typeof value === 'string' && /^(?:(?:inline script|lines [1-9]\d{0,5}(?:–[1-9]\d{0,5})?|test|build|typecheck|lint|check|status|diff|log|show|rev-parse|ls-files|GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)(?: · \+[1-7] operations)?|\+[1-7] operations)$/.test(value) ? value : undefined;
}
/** Rebuild sparse metadata at the outbound boundary; never retain caller arrays. */
export function normalizeSlackActivityDetail(value: unknown): SlackActivityDetail | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const data = value as Record<string, unknown>;
    const result: SlackActivityDetail = {};
    const purpose = safeText(data['purpose'], 120), tool = identifier(data['tool']), runner = identifier(data['runner']);
    const query = safeText(data['query'], 60), extra = qualifier(data['qualifier']);
    if (purpose) result.purpose = purpose;
    if (tool) result.tool = tool;
    if (runner) result.runner = runner;
    if (typeof data['action'] === 'string' && actions.has(data['action'])) result.action = data['action'] as NonNullable<SlackActivityDetail['action']>;
    if (Array.isArray(data['targets'])) {
        const targets = data['targets'].slice(0, 2).map(sanitizeSlackFileLabel).filter((v): v is string => Boolean(v))
            .filter(v => result.action !== 'HTTP' || (/^[a-z\d.-]+\.[a-z]{2,}$/i.test(v) && Boolean(safeText(v, 100))));
        if (targets.length) result.targets = targets;
    }
    if (query && (!result.action || result.action === 'Search')) result.query = query;
    if (extra) result.qualifier = extra;
    return Object.keys(result).length ? result : undefined;
}
export function formatSlackActivityDetail(value: unknown): string {
    const d = normalizeSlackActivityDetail(value);
    if (!d) return '';
    const parts = [d.action ?? d.tool, d.runner, d.query, d.targets?.join(', '), d.qualifier].filter(Boolean);
    const operation = parts.join(' ');
    return clip([d.purpose, operation].filter(Boolean).join('\n'), 200);
}

type Segment = { words: string[]; separator: string; stdinCode?: boolean };
/** Finite literal lexer, not a shell interpreter. Expansions fail closed; output redirection ends the observable prefix. */
function lex(command: string): Segment[] | undefined {
    if (!command || command.length > MAX_COMMAND || /[\p{Cf}\p{Cs}\x00-\x08\x0b-\x1f]/u.test(command)) return undefined;
    const result: Segment[] = [];
    let words: string[] = [], word = '', quote = '', active = false, plainWord = true, count = 0;
    const push = () => { if (active) { words.push(word); count++; word = ''; active = false; plainWord = true; } };
    for (let i = 0; i < command.length; i++) {
        const c = command[i]!;
        if (!quote && !active && c === '#') {
            const newline = command.indexOf('\n', i);
            if (newline < 0) break;
            i = newline - 1; // Let the existing separator owner process the newline.
            continue;
        }
        if (!quote && (c === '>' || c === '<')) {
            // Only an adjacent, unquoted IO number belongs to the redirect.
            // Its destination and the entire suffix are deliberately opaque.
            const io = active && plainWord && /^\d+$/.test(word) ? word : undefined;
            if (io !== undefined) { word = ''; active = false; }
            push(); if (words.length) result.push({ words, separator: '',
                ...(c === '<' && command[i + 1] === '<' && (io === undefined || io === '0') ? { stdinCode: true } : {}) });
            return count <= 128 && result.length <= 8 ? result : undefined;
        }
        if (c === '$' || c === '`') return undefined;
        if (quote) {
            if (c === quote) { quote = ''; continue; }
            if (c === '\\' && quote === '"') {
                const next = command[i + 1];
                if (next === undefined) return undefined;
                if (next === '"' || next === '\\') { word += next; i++; } else word += c;
            }
            else word += c;
        } else if (c === '"' || c === "'") { quote = c; active = true; plainWord = false; }
        else if (c === '\\') { plainWord = false; if (++i >= command.length) return undefined; word += command[i]; active = true; }
        else if (c === '&' || c === '|' || c === ';' || c === '\n') {
            push();
            const sep = c === '&' && command[i + 1] === '&' ? (i++, '&&') : c;
            if (sep === '&' || (c === '|' && command[i + 1] === '|')) return undefined;
            if (words.length) result.push({ words, separator: sep });
            words = [];
        } else if (/\s/.test(c)) {
            push();
            if (hasInterpreterPrefix(words)) {
                return count <= 128 && result.length < 8 ? [...result, { words, separator: '' }] : undefined; // Never inspect inline bodies or script arguments.
            }
        }
        else { word += c; active = true; }
        if (count > 128 || result.length >= 8) return undefined;
    }
    if (quote) return undefined;
    push(); if (words.length) result.push({ words, separator: '' });
    return count <= 128 && result.length <= 8 ? result : undefined;
}
function executable(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    return identifier(raw.includes('\\') ? win32.basename(raw) : posix.basename(raw));
}
function withoutAssignments(words: string[]): string[] {
    let i = 0;
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!)) i++;
    return words.slice(i);
}
function targetList(values: string[], root?: string, displayRoot?: string): string[] {
    return values.slice(0, 2).map(value => {
        if (!projectSlackFilePath(value, root)) return undefined;
        if (!root) return projectSlackFilePath(value);
        const path = /^[A-Za-z]:[\\/]/.test(root) || root.includes('\\') || value.includes('\\') ? win32 : posix;
        return projectSlackFilePath(path.resolve(root, value), displayRoot);
    }).filter((v): v is string => Boolean(v));
}
function operation(words: string[], root?: string, displayRoot?: string): SlackActivityDetail {
    const runner = executable(words[0]);
    if (!runner) return {};
    const args = words.slice(1), base: SlackActivityDetail = { runner };
    if (['cat', 'head', 'tail'].includes(runner)) {
        const paths: string[] = []; let range: string | undefined; let operands = false;
        for (let i = 0; i < args.length; i++) {
            const arg = args[i]!;
            if (operands) { paths.push(arg); continue; }
            if (arg === '--') { operands = true; continue; }
            if (runner === 'cat' && arg === '-n') continue;
            if (arg === '-n' && /^[1-9]\d{0,5}$/.test(args[i + 1] ?? '')) { range = `lines ${args[++i]}`; continue; }
            if (/^-\d+$/.test(arg)) { range = `lines ${arg.slice(1)}`; continue; }
            if (arg.startsWith('-')) { if (!['--', '-q', '-v'].includes(arg)) return base; continue; }
            paths.push(arg);
        }
        return { action: 'Read', targets: targetList(paths, root, displayRoot), ...(range ? { qualifier: range } : {}) };
    }
    if (runner === 'sed' && args[0] === '-n' && /^([1-9]\d{0,5})(?:,([1-9]\d{0,5}))?p$/.test(args[1] ?? '')) {
        if (args.slice(2).some(arg => arg.startsWith('-'))) return base;
        const range = args[1]!.slice(0, -1).replace(',', '–');
        return { action: 'Read', targets: targetList(args.slice(2), root, displayRoot), qualifier: `lines ${range}` };
    }
    if (runner === 'ls') {
        const paths: string[] = []; let operands = false;
        for (const arg of args) {
            if (!operands && arg === '--') { operands = true; continue; }
            if (!operands && arg.startsWith('-')) {
                if (!/^-[alhAdFprRtS]+$/.test(arg)) return base;
            } else paths.push(arg);
        }
        return { action: 'List', targets: targetList(paths, root, displayRoot) };
    }
    if (runner === 'rg' || runner === 'grep') {
        const positional: string[] = []; let query: string | undefined; let list = false, operands = false;
        for (let i = 0; i < args.length; i++) {
            const arg = args[i]!;
            if (operands) { positional.push(arg); continue; }
            if (arg === '--') { operands = true; continue; }
            if (arg === '--files' && runner === 'rg') { list = true; continue; }
            if (runner === 'rg' && ['-g', '--glob'].includes(arg)) { if (args[++i] === undefined) return base; continue; }
            if (runner === 'rg' && arg.startsWith('--glob=')) continue;
            if (arg === '-e' || arg === '--regexp') { query = args[++i]; continue; }
            if (arg.startsWith('-') && arg !== '--') {
                if (!/^-[nirlwsvch]+$/i.test(arg) && !['--hidden', '--fixed-strings', '--line-number'].includes(arg)) return base;
                continue;
            }
            if (arg !== '--') positional.push(arg);
        }
        if (list) return { action: 'List', targets: targetList(positional, root, displayRoot) };
        query ??= positional.shift();
        return { action: 'Search', ...(query ? { query } : {}), targets: targetList(positional, root, displayRoot) };
    }
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(runner)) {
        const task = args[0] === 'run' ? args[1] : args[0];
        if (task && tasks.has(task)) return { action: task === 'test' ? 'Test' : task === 'build' ? 'Build' : 'Run', runner, qualifier: task };
        return base;
    }
    if (scripts.has(runner)) {
        if (args[0] === '-m' && ['pytest', 'unittest'].includes(args[1] ?? '')) {
            const operands = args.slice(2);
            // Unknown test flags may consume values. Keep the known operation,
            // but never reinterpret any of those values as test-file targets.
            return operands.some(arg => arg.startsWith('-')) ? { action: 'Test', runner }
                : { action: 'Test', runner, targets: targetList(operands, root, displayRoot) };
        }
        let testMode = false;
        for (const arg of args) {
            if (inlineFlags.has(arg)) return { action: 'Run', runner, qualifier: 'inline script' };
            if (arg.startsWith('-')) {
                if (!interpreterFlags.has(arg)) return base;
                if (arg === '--test') testMode = true;
                continue;
            }
            const targets = targetList([arg], root, displayRoot);
            if (!targets.length) return base;
            const test = testMode || /(?:^|[/.\-])test(?:[/.\-]|$)|(?:^|\/)tests\//.test(arg);
            return { action: test ? 'Test' : 'Run', runner, targets };
        }
        return base;
    }
    if (runner === 'git' && gitTasks.has(args[0] ?? '')) {
        const end = args.indexOf('--');
        return { action: 'Git', qualifier: args[0]!, ...(end >= 0 ? { targets: targetList(args.slice(end + 1), root, displayRoot) } : {}) };
    }
    if (runner === 'curl') {
        let method = 'GET'; let explicitMethod: string | undefined; let host: string | undefined;
        for (let i = 0; i < args.length; i++) {
            const arg = args[i]!;
            if (['-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode', '--json', '-u', '--user', '-o', '--output'].includes(arg)) { if (arg.includes('data') || arg === '-d' || arg === '--json') method = 'POST'; i++; continue; }
            if (arg === '-X' || arg === '--request') { const value = args[++i]; if (value && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(value)) explicitMethod = value; else return { action: 'HTTP' }; continue; }
            if (arg === '-I' || arg === '--head') { method = 'HEAD'; continue; }
            if (arg.startsWith('-') && !/^-[sSfLf]+$/.test(arg) && !['--silent', '--show-error', '--fail', '--location'].includes(arg)) return { action: 'HTTP' };
            if (/^https?:\/\//i.test(arg)) {
                try { const url = new URL(arg); if (/^[a-z\d.-]+\.[a-z]{2,}$/i.test(url.hostname) && safeText(url.hostname, 100)) host ??= url.hostname; } catch { /* Invalid URLs grant no host display. */ }
            }
        }
        return { action: 'HTTP', qualifier: explicitMethod ?? method, ...(host ? { targets: [host] } : {}) };
    }
    return base;
}

export function projectSlackActivityDetail(
    data: Record<string, unknown>, name: unknown, workingDir?: string, source: 'print' | 'native' = 'print',
): SlackActivityDetail | undefined {
    let input: unknown = data['input'];
    if (typeof input === 'string') {
        try { input = input.length <= MAX_COMMAND ? JSON.parse(input) : undefined; } catch { input = undefined; }
    }
    const args = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : undefined;
    const toolName = typeof name === 'string' && name.length <= 256 ? name.trim().toLowerCase() : '';
    const purpose = shells.has(toolName)
        ? source === 'native' ? args?.['description'] : data['description'] ?? args?.['description']
        : undefined;
    const result: Record<string, unknown> = { tool: identifier(name), purpose };
    if (!shells.has(toolName)) {
        const fileAction = new Map<string, SlackActivityDetail['action']>([
            ['read', 'Read'], ['read_file', 'Read'], ['readfile', 'Read'],
            ['write', 'Write'], ['write_file', 'Write'], ['writefile', 'Write'],
            ['edit', 'Edit'], ['edit_file', 'Edit'], ['editfile', 'Edit'],
        ]).get(toolName);
        if (fileAction) {
            result['action'] = fileAction;
            const target = projectSlackToolFile(data, name, workingDir, source === 'print');
            if (target) result['targets'] = [target];
        } else if (args && ['grep', 'search', 'glob', 'list', 'list_dir'].includes(toolName)) {
            result['action'] = toolName === 'grep' || toolName === 'search' ? 'Search' : 'List';
            result['targets'] = targetList([args['file_path'] ?? args['path'] ?? args['filename']].filter((v): v is string => typeof v === 'string'), workingDir, workingDir);
            if (result['action'] === 'Search') result['query'] = args['query'] ?? args['pattern'];
        }
        return normalizeSlackActivityDetail(result);
    }
    const rawCommand = args?.['command'] ?? args?.['cmd'] ?? (source === 'print' ? data['detail'] : undefined);
    if (typeof rawCommand !== 'string' || rawCommand.length > MAX_COMMAND) return normalizeSlackActivityDetail(result);
    let command: string = rawCommand;
    let unresolvedSetup = false;
    // A variable-only cd prefix gives no trusted cwd. Discard that operand,
    // without expanding it, while retaining the following literal operation.
    const setup = command.match(/^\s*cd\s+("[^"\n]*"|'[^'\n]*'|[^\s;&|]+)\s*&&\s*/);
    if (setup && /[$`]/.test(setup[1]!)) { command = command.slice(setup[0].length); unresolvedSetup = true; }
    const segments = lex(command);
    if (!segments) {
        const first = command.trim().match(/^([A-Za-z0-9_./\\-]+)(?=\s|$)/)?.[1];
        result['runner'] = executable(first);
        return normalizeSlackActivityDetail(result);
    }
    let root = unresolvedSetup ? undefined : workingDir, selected: SlackActivityDetail | undefined, additional = 0;
    for (const segment of segments) {
        const words = withoutAssignments(segment.words);
        if (!words.length) continue;
        if (words[0] === 'cd') {
            if (words.length === 2 && words[1] === '.' && segment.separator !== '|') continue;
            if (words.length === 2 && segment.separator !== '|' && projectSlackFilePath(words[1], root)) {
                const path = /^[A-Za-z]:[\\/]/.test(root ?? words[1]!) || root?.includes('\\') || words[1]!.includes('\\') ? win32 : posix;
                root = path.isAbsolute(words[1]!) ? words[1] : root ? path.resolve(root, words[1]!) : undefined;
            } else root = undefined;
            continue;
        }
        if (selected) { additional++; continue; }
        selected = operation(words, root, workingDir);
        if (segment.stdinCode && words.length === 1 && scripts.has(executable(words[0]) ?? '')) {
            selected = { action: 'Run', runner: executable(words[0]), qualifier: 'inline script' } as SlackActivityDetail;
        }
    }
    if (selected) Object.assign(result, selected);
    if (additional) result['qualifier'] = `${selected?.qualifier ? `${selected.qualifier} · ` : ''}+${Math.min(additional, 7)} operations`;
    return normalizeSlackActivityDetail(result);
}

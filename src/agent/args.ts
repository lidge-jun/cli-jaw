// ─── Agent CLI Argument Builders ──────────────────────
// Extracted from agent.js for 500-line compliance.

import { existsSync } from 'node:fs';
import os from 'node:os';

const isCodexSparkModel = (model: string) => !!model && /spark/i.test(model);
const GEMINI_MAX_INCLUDE_DIRECTORIES = 5;

type BuildArgOptions = {
    fastMode?: boolean;
    sysPrompt?: string;
    includeDirectories?: string[];
    claudeBin?: string;
    homedir?: string;
    platform?: NodeJS.Platform;
    release?: string;
    env?: NodeJS.ProcessEnv;
    pathExists?: (path: string) => boolean;
};

function normalizePathForDedupe(dir: string): string {
    return dir.trim().replace(/[\\/]+$/, '');
}

function windowsPathToWslPath(dir: string): string | null {
    const match = /^([A-Za-z]):[\\/](.*)$/.exec(dir.trim());
    if (!match) return null;
    const [, driveRaw, restRaw] = match;
    if (!driveRaw || restRaw === undefined) return null;
    const drive = driveRaw.toLowerCase();
    const rest = restRaw.replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`;
}

function isWslRuntime(options: BuildArgOptions): boolean {
    const platform = options.platform ?? process.platform;
    if (platform !== 'linux') return false;
    const env = options.env ?? process.env;
    const release = options.release ?? os.release();
    return Boolean(env['WSL_DISTRO_NAME'] || env['WSL_INTEROP'] || /microsoft|wsl/i.test(release));
}

function detectWslWindowsHome(options: BuildArgOptions): string[] {
    if (!isWslRuntime(options)) return [];
    const env = options.env ?? process.env;
    const pathExists = options.pathExists ?? existsSync;
    const candidates: string[] = [];
    const userProfileEnv = env['USERPROFILE'];
    const userProfile = userProfileEnv ? windowsPathToWslPath(userProfileEnv) : null;
    if (userProfile) candidates.push(userProfile);
    const user = env['USERNAME'] || env['USER'];
    if (user) candidates.push(`/mnt/c/Users/${user}`);
    return candidates.filter((dir) => pathExists(dir));
}

export function resolveGeminiIncludeDirectories(options: BuildArgOptions = {}): string[] {
    const dirs = [
        options.homedir ?? os.homedir(),
        ...detectWslWindowsHome(options),
        ...(options.includeDirectories ?? []),
    ];
    const seen = new Set<string>();
    const resolved: string[] = [];
    for (const dir of dirs) {
        const normalized = normalizePathForDedupe(dir || '');
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        resolved.push(normalized);
        if (resolved.length >= GEMINI_MAX_INCLUDE_DIRECTORIES) break;
    }
    return resolved;
}

function geminiIncludeDirectoryArgs(options: BuildArgOptions): string[] {
    return resolveGeminiIncludeDirectories(options)
        .flatMap((dir) => ['--include-directories', dir]);
}

/**
 * Session storage bucket — codex Spark lives in its own bucket so cross-model
 * resumes don't send a spark session_id to a gpt-5.4 run (or vice versa), which
 * would trigger `thread/resume failed: no rollout found` on the server side.
 */
export function resolveSessionBucket(cli: string | null | undefined, model: string | null | undefined): string {
    if (cli === 'claude-i') return 'claude-i';
    if (cli === 'codex-app') return 'codex-app';
    if (cli === 'grok') return 'grok';
    if (cli === 'codex' && isCodexSparkModel(model || '')) return 'codex-spark';
    return cli || '';
}

export function buildArgs(cli: string, model: string, effort: string, prompt: string, sysPrompt: string, permissions = 'auto', options: BuildArgOptions = {}) {
    const autoPerm = permissions === 'auto';
    switch (cli) {
        case 'claude':
            return ['--print', '--verbose', '--output-format', 'stream-json',
                '--include-partial-messages',
                ...(autoPerm ? ['--dangerously-skip-permissions'] : []),
                '--max-turns', '50',
                ...(model && model !== 'default' ? ['--model', model] : []),
                ...(effort && effort !== 'medium' ? ['--effort', effort] : []),
                ...(sysPrompt ? ['--append-system-prompt', sysPrompt] : [])];
        case 'claude-i': {
            const claudeExtraArgs: string[] = [];
            if (model && model !== 'default') claudeExtraArgs.push('--model', model);
            if (effort && effort !== 'medium') claudeExtraArgs.push('--effort', effort);
            if (sysPrompt) claudeExtraArgs.push('--append-system-prompt', sysPrompt);
            // claude-i can't interact with permission dialogs — always bypass
            if (autoPerm) claudeExtraArgs.push('--dangerously-skip-permissions');
            else claudeExtraArgs.push('--permission-mode', 'auto');
            return ['run', '--jsonl',
                '--output-format', 'stream-json',
                '--timeout-ms', '600000',
                ...(options.claudeBin ? ['--claude-bin', options.claudeBin] : []),
                ...(claudeExtraArgs.length ? ['--', ...claudeExtraArgs] : [])];
        }
        case 'codex': {
            const spark = isCodexSparkModel(model);
            const reasoningArgs = spark ? [] : [
                ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []),
                '-c', 'model_reasoning_summary="detailed"',
                '-c', 'hide_agent_reasoning=false',
                '-c', 'show_raw_agent_reasoning=true',
            ];
            // Spark is text-only at 128k context (per OpenAI launch post).
            // Pin 128k max + 110k auto-compact threshold so long turns auto-compact before overflow.
            const sparkContextArgs = spark ? [
                '-c', 'model_context_window=128000',
                '-c', 'model_auto_compact_token_limit=110000',
            ] : [];
            return ['exec',
                ...(model && model !== 'default' ? ['-m', model] : []),
                ...reasoningArgs,
                ...sparkContextArgs,
                ...(options.fastMode ? ['-c', 'service_tier="fast"'] : []),
                ...(autoPerm ? ['--dangerously-bypass-approvals-and-sandbox'] : []),
                '--skip-git-repo-check', '--json'];
        }
        case 'gemini':
            return ['-p', prompt || '',
                ...(model && model !== 'default' ? ['-m', model] : []),
                '--skip-trust',
                '--approval-mode', 'yolo',
                ...geminiIncludeDirectoryArgs(options),
                '-o', 'stream-json'];
        case 'grok':
            return ['-p', prompt || '',
                ...(model && model !== 'default' ? ['-m', model] : []),
                '--output-format', 'streaming-json',
                '--no-alt-screen',
                ...(autoPerm ? ['--always-approve', '--permission-mode', 'bypassPermissions'] : [])];
        case 'codex-app':
            return ['app-server', '--listen', 'stdio://'];
        case 'opencode':
            return ['run',
                ...(model && model !== 'default' ? ['-m', model] : []),
                ...(effort ? ['--variant', effort] : []),
                '--thinking',
                '--format', 'json',
                prompt || ''];
        default:
            return [];
    }
}

export function buildResumeArgs(cli: string, model: string, effort: string, sessionId: string, prompt: string, permissions = 'auto', options: BuildArgOptions = {}) {
    const autoPerm = permissions === 'auto';
    switch (cli) {
        case 'claude':
            return ['--print', '--verbose', '--output-format', 'stream-json',
                '--include-partial-messages',
                ...(autoPerm ? ['--dangerously-skip-permissions'] : []),
                '--resume', sessionId,
                '--max-turns', '50',
                ...(model && model !== 'default' ? ['--model', model] : []),
                ...(effort && effort !== 'medium' ? ['--effort', effort] : []),
                ...(options.sysPrompt ? ['--append-system-prompt', options.sysPrompt] : [])];
        case 'claude-i': {
            const claudeExtraArgs: string[] = [];
            if (model && model !== 'default') claudeExtraArgs.push('--model', model);
            if (effort && effort !== 'medium') claudeExtraArgs.push('--effort', effort);
            if (options.sysPrompt) claudeExtraArgs.push('--append-system-prompt', options.sysPrompt);
            if (autoPerm) claudeExtraArgs.push('--dangerously-skip-permissions');
            else claudeExtraArgs.push('--permission-mode', 'auto');
            return ['run', '--jsonl',
                '--output-format', 'stream-json',
                '--timeout-ms', '600000',
                ...(options.claudeBin ? ['--claude-bin', options.claudeBin] : []),
                '--resume', sessionId,
                ...(claudeExtraArgs.length ? ['--', ...claudeExtraArgs] : [])];
        }
        case 'codex': {
            const spark = isCodexSparkModel(model);
            return ['exec', 'resume',
                ...(model && model !== 'default' ? ['--model', model] : []),
                ...(spark ? [] : ['-c', 'model_reasoning_summary="detailed"']),
                ...(spark ? [] : ['-c', 'hide_agent_reasoning=false']),
                ...(spark ? [] : ['-c', 'show_raw_agent_reasoning=true']),
                ...(spark ? ['-c', 'model_context_window=128000'] : []),
                ...(spark ? ['-c', 'model_auto_compact_token_limit=110000'] : []),
                ...(options.fastMode ? ['-c', 'service_tier="fast"'] : []),
                ...(autoPerm ? ['--dangerously-bypass-approvals-and-sandbox'] : []),
                '--skip-git-repo-check',
                sessionId, prompt || '', '--json'];
        }
        case 'gemini':
            return ['--resume', sessionId,
                '-p', prompt || '',
                ...(model && model !== 'default' ? ['-m', model] : []),
                '--skip-trust',
                '--approval-mode', 'yolo',
                ...geminiIncludeDirectoryArgs(options),
                '-o', 'stream-json'];
        case 'grok':
            return ['-p', prompt || '',
                '--resume', sessionId,
                ...(model && model !== 'default' ? ['-m', model] : []),
                '--output-format', 'streaming-json',
                '--no-alt-screen',
                ...(autoPerm ? ['--always-approve', '--permission-mode', 'bypassPermissions'] : [])];
        case 'codex-app':
            return ['app-server', '--listen', 'stdio://'];
        case 'opencode':
            return ['run', '-s', sessionId,
                ...(model && model !== 'default' ? ['-m', model] : []),
                ...(effort ? ['--variant', effort] : []),
                '--thinking',
                '--format', 'json',
                prompt || ''];
        default:
            return [];
    }
}

// ─── Agent CLI Argument Builders ──────────────────────
// Extracted from agent.js for 500-line compliance.

import os from 'node:os';
import type { AgyCapabilities } from './agy-capabilities.js';
import { resolveCursorModelVariant } from './cursor-runtime.js';

const isCodexSparkModel = (model: string) => !!model && /spark/i.test(model);
export const AGY_MAX_ADD_DIRECTORIES = 8;
export const AGY_PRINT_TIMEOUT = '10m';

export function formatAgyPrintTimeout(ms: number): string {
    const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 10 * 60_000;
    return `${Math.ceil(safeMs / 60_000)}m`;
}

// Claude Code fast mode is enabled by merging { fastMode: true } into the spawned
// CLI's settings via --settings (the claude analogue of codex's service_tier="fast").
// Gated on options.fastMode, which is sourced from perCli.<cli>.fastMode in spawn.ts.
const CODEXCLAW_PLUGIN_DISABLE_CONFIG = 'plugins."codexclaw@personal".enabled=false';

type BuildArgOptions = {
    fastMode?: boolean;
    sysPrompt?: string;
    includeDirectories?: string[];
    homedir?: string;
    workingDir?: string;
    platform?: NodeJS.Platform;
    release?: string;
    env?: NodeJS.ProcessEnv;
    pathExists?: (path: string) => boolean;
    agyLogFile?: string;
    agyPrintTimeout?: string;
    agyCapabilities?: AgyCapabilities;
};

const KIRO_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

/**
 * Claude's `ultracode` tier.
 *
 * It is NOT an effort level on the wire. `claude --effort` accepts only
 * low/medium/high/xhigh/max, and the bundle resolves the tier by reading
 * `settings.ultracode === true` and returning `"xhigh"`. Claude Code's own
 * `/effort ultracode` does exactly that: it normalizes the value to `xhigh` and
 * sends `{effortLevel, ultracode:true}` as a separate settings payload.
 *
 * So cli-jaw offers one tier to the user and splits it at the boundary: the flag
 * carries `xhigh`, the settings object carries the switch.
 */
export const CLAUDE_ULTRACODE_EFFORT = 'ultracode';
const CLAUDE_ULTRACODE_WIRE_EFFORT = 'xhigh';

export function isClaudeUltracodeEffort(effort: string | null | undefined): boolean {
    return (effort || '').trim() === CLAUDE_ULTRACODE_EFFORT;
}

/**
 * The effort value to put on Claude's `--effort` flag.
 *
 * Everything except `ultracode` passes through untouched, so an unknown value
 * still reaches the CLI and is rejected there rather than silently rewritten here.
 */
export function normalizeClaudeEffort(effort: string | null | undefined): string {
    return isClaudeUltracodeEffort(effort) ? CLAUDE_ULTRACODE_WIRE_EFFORT : (effort || '');
}

/** `--effort` arguments for a Claude invocation, or none when the default applies. */
function claudeEffortArgs(effort: string): string[] {
    const wire = normalizeClaudeEffort(effort);
    return wire && wire !== 'medium' ? ['--effort', wire] : [];
}

function kiroEffortArgs(effort: string): string[] {
    if (!effort || !KIRO_EFFORTS.has(effort)) return [];
    return ['--effort', effort === 'xhigh' ? 'max' : effort];
}

function normalizePathForDedupe(dir: string): string {
    return dir.trim().replace(/[\\/]+$/, '');
}



export function resolveAgyAddDirectories(options: BuildArgOptions = {}): string[] {
    const dirs = [
        options.workingDir,
        options.homedir ?? os.homedir(),
        ...(options.includeDirectories ?? []),
    ];
    const seen = new Set<string>();
    const resolved: string[] = [];
    for (const dir of dirs) {
        const normalized = normalizePathForDedupe(dir || '');
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        resolved.push(normalized);
        if (resolved.length >= AGY_MAX_ADD_DIRECTORIES) break;
    }
    return resolved;
}

function agyAddDirArgs(options: BuildArgOptions): string[] {
    return resolveAgyAddDirectories(options)
        .flatMap((dir) => ['--add-dir', dir]);
}

function agyPrintArgs(prompt: string, options: BuildArgOptions): string[] {
    const caps = options.agyCapabilities;
    if (!caps) return ['-p', prompt || ''];
    if (!caps.print || !caps.printFlag) {
        throw new Error('AGY print mode requires print mode support (-p/--print/--prompt)');
    }
    return [caps.printFlag, prompt || ''];
}

function agyOptionalArgs(options: BuildArgOptions, key: keyof AgyCapabilities, args: string[]): string[] {
    const caps = options.agyCapabilities;
    if (!caps) return args;
    return caps[key] ? args : [];
}

/**
 * Claude Code's session-scoped settings, passed as one `--settings` object.
 *
 * Both knobs live in the same place. `fastMode` is the claude analogue of codex's
 * `service_tier="fast"`; `ultracode` is what the bundle's own schema calls
 * "xhigh effort plus standing dynamic-workflow orchestration ... typically
 * provided via --settings or the apply_flag_settings control request".
 *
 * They merge into a single object because a second `--settings` would replace the
 * first rather than extend it, so emitting the flag twice would silently drop one
 * of the two.
 */
function claudeSettingsArgs(options: BuildArgOptions, effort?: string): string[] {
    const settings: Record<string, boolean> = {};
    if (options.fastMode) settings['fastMode'] = true;
    if (isClaudeUltracodeEffort(effort)) settings['ultracode'] = true;
    return Object.keys(settings).length > 0 ? ['--settings', JSON.stringify(settings)] : [];
}

/**
 * Session storage bucket — codex Spark lives in its own bucket so cross-model
 * resumes don't send a spark session_id to a gpt-5.4 run (or vice versa), which
 * would trigger `thread/resume failed: no rollout found` on the server side.
 */
export function resolveSessionBucket(cli: string | null | undefined, model: string | null | undefined, _aiEProvider?: string | null): string {
    if (cli === 'codex-app') return 'codex-app';
    if (cli === 'grok') return 'grok';
    if (cli === 'pi') return 'pi';
    if (cli === 'codex' && isCodexSparkModel(model || '')) return 'codex-spark';
    return cli || '';
}

export type CodexAppLaneMode = 'native' | 'fallback';

export function resolveCodexAppLaneKey(
    scope: string,
    model: string,
    effort: string,
    laneMode: CodexAppLaneMode,
): string {
    return laneMode === 'fallback' ? `${scope}:${model}:${effort}` : scope;
}

export function resolveScopedSessionBucket(
    cli: string | null | undefined,
    model: string | null | undefined,
    aiEProvider: string | null | undefined,
    scope: string,
    effort: string,
    laneMode: CodexAppLaneMode,
    // Multiplex owns the scoped codex-app key. Without this flag a non-multiplex
    // codex-app run would be handed the multiplex key shape and, on the default scope,
    // stop finding the conversation it has been using all along.
    codexAppMultiplex = true,
): string {
    const base = resolveSessionBucket(cli, model, aiEProvider);
    if (cli === 'codex-app' && codexAppMultiplex) {
        const laneKey = resolveCodexAppLaneKey(scope, model || 'default', effort, laneMode);
        return `${base}:${laneKey}`;
    }
    // Every other runtime gets a per-scope bucket too (073 §2.1). The default scope keeps
    // the bare name on purpose: a session that existed before this change continues in the
    // conversation it was already using instead of silently starting over.
    return scope === 'default' ? base : `${base}:${scope}`;
}

export function buildArgs(cli: string, model: string, effort: string, prompt: string, sysPrompt: string, permissions = 'auto', options: BuildArgOptions = {}) {
    const autoPerm = permissions === 'auto';
    switch (cli) {
        case 'agy':
            return [...agyPrintArgs(prompt, options),
                ...(model && model !== 'default' ? agyOptionalArgs(options, 'model', ['--model', model]) : []),
                ...agyOptionalArgs(options, 'printTimeout', ['--print-timeout', options.agyPrintTimeout || AGY_PRINT_TIMEOUT]),
                ...(options.agyLogFile ? agyOptionalArgs(options, 'logFile', ['--log-file', options.agyLogFile]) : []),
                ...(autoPerm ? agyOptionalArgs(options, 'dangerousSkipPermissions', ['--dangerously-skip-permissions']) : []),
                ...agyOptionalArgs(options, 'addDir', agyAddDirArgs(options))];
        case 'claude':
            return ['--print', '--verbose', '--output-format', 'stream-json',
                '--include-partial-messages',
                ...(autoPerm ? ['--dangerously-skip-permissions'] : []),
                '--max-turns', '500',
                ...(model && model !== 'default' ? ['--model', model] : []),
                ...claudeEffortArgs(effort),
                ...claudeSettingsArgs(options, effort),
                ...(sysPrompt ? ['--append-system-prompt', sysPrompt] : [])];
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
                '-c', CODEXCLAW_PLUGIN_DISABLE_CONFIG,
                ...reasoningArgs,
                ...sparkContextArgs,
                '-c', `service_tier="${options.fastMode ? 'fast' : 'default'}"`,
                // Gated on the user's own permission policy, which is what the
                // docs mean by an attended choice. This is a different case
                // from a tool reaching for the flag on its own: an agent turn
                // exists to run commands, so Auto (YOLO) is the user saying
                // they accept that. The vision path builds its invocation in
                // browser/vision-provider.ts and defaults the flag OFF,
                // because classifying an image needs no such authority.
                ...(autoPerm ? ['--dangerously-bypass-approvals-and-sandbox'] : []),
                '--skip-git-repo-check', '--json'];
        }
        case 'cursor': {
            const cursorModel = resolveCursorModelVariant(model, effort);
            return ['-p',
                '--trust',
                '--output-format', 'stream-json',
                ...(cursorModel && cursorModel !== 'default' ? ['--model', cursorModel] : []),
                ...(autoPerm ? ['--force'] : []),
                prompt || ''];
        }
        case 'kiro-code':
            return ['chat', '--no-interactive',
                ...(autoPerm ? ['--trust-all-tools'] : []),
                ...(model && model !== 'default' ? ['--model', model] : []),
                ...kiroEffortArgs(effort),
                prompt || ''];
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
        case 'agy': {
            if (options.agyCapabilities && !options.agyCapabilities.conversation) {
                throw new Error('AGY exact resume requires --conversation support');
            }
            return [...(sessionId ? ['--conversation', sessionId] : []),
                ...agyPrintArgs(prompt, options),
                ...(model && model !== 'default' ? agyOptionalArgs(options, 'model', ['--model', model]) : []),
                ...agyOptionalArgs(options, 'printTimeout', ['--print-timeout', options.agyPrintTimeout || AGY_PRINT_TIMEOUT]),
                ...(options.agyLogFile ? agyOptionalArgs(options, 'logFile', ['--log-file', options.agyLogFile]) : []),
                ...(autoPerm ? agyOptionalArgs(options, 'dangerousSkipPermissions', ['--dangerously-skip-permissions']) : []),
                ...agyOptionalArgs(options, 'addDir', agyAddDirArgs(options))];
        }
        case 'claude':
            return ['--print', '--verbose', '--output-format', 'stream-json',
                '--include-partial-messages',
                ...(autoPerm ? ['--dangerously-skip-permissions'] : []),
                '--resume', sessionId,
                '--max-turns', '500',
                ...(model && model !== 'default' ? ['--model', model] : []),
                ...claudeEffortArgs(effort),
                ...claudeSettingsArgs(options, effort),
                ...(options.sysPrompt ? ['--append-system-prompt', options.sysPrompt] : [])];
        case 'codex': {
            const spark = isCodexSparkModel(model);
            return ['exec', 'resume',
                ...(model && model !== 'default' ? ['--model', model] : []),
                '-c', CODEXCLAW_PLUGIN_DISABLE_CONFIG,
                ...(spark ? [] : ['-c', 'model_reasoning_summary="detailed"']),
                ...(spark ? [] : ['-c', 'hide_agent_reasoning=false']),
                ...(spark ? [] : ['-c', 'show_raw_agent_reasoning=true']),
                ...(spark ? ['-c', 'model_context_window=128000'] : []),
                ...(spark ? ['-c', 'model_auto_compact_token_limit=110000'] : []),
                '-c', `service_tier="${options.fastMode ? 'fast' : 'default'}"`,
                ...(autoPerm ? ['--dangerously-bypass-approvals-and-sandbox'] : []),
                '--skip-git-repo-check',
                // '-' reads the prompt from stdin. The fresh path already does this;
                // keeping resume on argv left the SAME untrusted text exposed to
                // cmd.exe parsing on Windows .cmd shims (#367), so the two paths now
                // have identical guarantees.
                sessionId, '-', '--json'];
        }
        case 'cursor': {
            const cursorModel = resolveCursorModelVariant(model, effort);
            return ['--resume', sessionId,
                '-p',
                '--trust',
                '--output-format', 'stream-json',
                ...(cursorModel && cursorModel !== 'default' ? ['--model', cursorModel] : []),
                ...(autoPerm ? ['--force'] : []),
                prompt || ''];
        }
        case 'kiro-code':
            return ['chat', '--no-interactive',
                '--resume-id', sessionId,
                ...(autoPerm ? ['--trust-all-tools'] : []),
                ...(model && model !== 'default' ? ['--model', model] : []),
                ...kiroEffortArgs(effort),
                prompt || ''];
        case 'grok':
            return ['-p', prompt || '',
                ...(sessionId ? ['--resume', sessionId] : []),
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

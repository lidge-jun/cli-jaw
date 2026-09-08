/**
 * src/browser/vision-provider.ts — how the vision provider is invoked.
 *
 * The invocation used to be a literal array inside the pipeline, which is why
 * it drifted from the documented safety position without anyone noticing:
 * `--dangerously-bypass-approvals-and-sandbox` was passed unconditionally for
 * what is a pure image-classification call, while the skill docs stated that
 * cli-jaw never adds it automatically. Describing the invocation here makes
 * that disagreement visible and testable instead of buried in a spawn call.
 *
 * The flag cannot simply be deleted. It is documented as the only known
 * workaround for the Windows sandbox killing `codex exec` children with exit
 * `-1073741502` and an empty stderr. So it becomes an explicit opt-in that is
 * off by default, and the Windows consequence is stated rather than implied.
 */

/** Disables the codexclaw plugin for the duration of the lookup. */
export const CODEXCLAW_PLUGIN_DISABLE_CONFIG = 'plugins."codexclaw@personal".enabled=false';

export type VisionInvocation = {
    command: string;
    args: string[];
    /** True when the sandbox bypass was included. Surfaced so a caller can report it. */
    bypassedSandbox: boolean;
};

export type VisionInvocationOptions = {
    screenshotPath: string;
    prompt: string;
    /**
     * Opt in to `--dangerously-bypass-approvals-and-sandbox`.
     *
     * Off by default. On Windows the sandbox has been observed to kill
     * `codex exec` children with exit `-1073741502` and an empty stderr, which
     * reads like a hang rather than a kill; that is the case this exists for.
     * It disables **both** approvals and the sandbox, so it is an attended,
     * explicit choice rather than a default.
     */
    bypassSandbox?: boolean;
};

/**
 * Build the argument list for a vision lookup.
 *
 * Pure, so the exact invocation can be asserted without spawning anything —
 * which matters here, because the defect this replaces was a single wrong
 * argument that no test could see.
 */
export function buildVisionInvocation(opts: VisionInvocationOptions): VisionInvocation {
    const bypassedSandbox = opts.bypassSandbox === true;
    const args = [
        'exec', '-i', opts.screenshotPath, '--json',
        // Do not persist a thread for a one-shot lookup.
        '--ephemeral',
        '-c', CODEXCLAW_PLUGIN_DISABLE_CONFIG,
        '--skip-git-repo-check',
    ];
    if (bypassedSandbox) args.push('--dangerously-bypass-approvals-and-sandbox');
    args.push(opts.prompt);
    return { command: 'codex', args, bypassedSandbox };
}

/**
 * Explain a spawn failure in terms of the sandbox, when that is what it was.
 *
 * Exit `-1073741502` with no stderr is the Windows sandbox terminating the
 * child. Without this the caller sees an empty error and reasonably concludes
 * the model failed, which sends them looking in the wrong place entirely.
 */
export const WINDOWS_SANDBOX_KILL_CODE = -1073741502;

/**
 * The same status as an unsigned 32-bit value (`0xC0000142`).
 *
 * Node normally surfaces a Windows exit status as a signed integer, but the
 * value travels through enough layers — shells, wrappers, JSON round-trips —
 * that the unsigned form does turn up. Matching only one representation would
 * mean the explanation silently never fires on exactly the platform it exists
 * for, which is the failure mode this whole phase is about.
 */
export const WINDOWS_SANDBOX_KILL_CODE_UNSIGNED = WINDOWS_SANDBOX_KILL_CODE >>> 0;

function isWindowsSandboxKill(code: number | null): boolean {
    return code === WINDOWS_SANDBOX_KILL_CODE || code === WINDOWS_SANDBOX_KILL_CODE_UNSIGNED;
}

export function explainExit(code: number | null, stderr: string, bypassedSandbox: boolean): string {
    const detail = stderr.trim().slice(0, 200);
    if (isWindowsSandboxKill(code) && !detail) {
        return bypassedSandbox
            ? `codex exec was terminated (exit ${code}) even with the sandbox bypass enabled`
            : `codex exec was terminated by the Windows sandbox (exit ${code}, no stderr). `
              + 'Retry with the sandbox bypass only if you accept that it disables both approvals and the sandbox.';
    }
    return `codex exec failed (code ${code})${detail ? ': ' + detail : ''}`;
}

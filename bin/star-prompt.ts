import { spawnSync, type SpawnSyncReturns, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

const REPO = 'lidge-jun/cli-jaw';

interface StarPromptState {
    prompted_at: string;
}

interface MaybePromptGithubStarDeps {
    stdinIsTTY?: boolean;
    stdoutIsTTY?: boolean;
    hasBeenPromptedFn?: () => Promise<boolean>;
    isGhInstalledFn?: () => boolean;
    markPromptedFn?: () => Promise<void>;
    askYesNoFn?: (question: string) => Promise<boolean>;
    starRepoFn?: () => StarRepoResult;
    logFn?: (message: string) => void;
    warnFn?: (message: string) => void;
}

export type StarRepoResult = { ok: true } | { ok: false; error: string };

function resolveJawHome(): string {
    return process.env.CLI_JAW_HOME
        ? resolve(process.env.CLI_JAW_HOME.replace(/^~(?=\/|$)/, homedir()))
        : join(homedir(), '.cli-jaw');
}

export function starPromptStatePath(): string {
    return join(resolveJawHome(), 'state', 'star-prompt.json');
}

export async function hasBeenPrompted(): Promise<boolean> {
    const path = starPromptStatePath();
    if (!existsSync(path)) return false;

    try {
        const content = await readFile(path, 'utf8');
        const state = JSON.parse(content) as StarPromptState;
        return typeof state.prompted_at === 'string';
    } catch {
        return false;
    }
}

export async function markPrompted(): Promise<void> {
    const path = starPromptStatePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ prompted_at: new Date().toISOString() }, null, 2));
}

export function isGhInstalled(): boolean {
    const result = spawnSync('gh', ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 3000,
        windowsHide: true,
    });
    return !result.error && result.status === 0;
}

export function starRepo(
    spawnSyncFn: (
        command: string,
        args: readonly string[],
        options: SpawnSyncOptionsWithStringEncoding,
    ) => SpawnSyncReturns<string> = spawnSync,
): StarRepoResult {
    const result = spawnSyncFn('gh', ['api', '-X', 'PUT', `/user/starred/${REPO}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000,
        windowsHide: true,
    });

    if (result.error) return { ok: false, error: result.error.message };
    if (result.status !== 0) {
        const stderr = (result.stderr || '').trim();
        const stdout = (result.stdout || '').trim();
        return { ok: false, error: stderr || stdout || `gh exited ${result.status}` };
    }
    return { ok: true };
}

async function askYesNo(question: string): Promise<boolean> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = (await rl.question(question)).trim().toLowerCase();
        return answer === '' || answer === 'y' || answer === 'yes';
    } finally {
        rl.close();
    }
}

export async function maybePromptGithubStar(deps: MaybePromptGithubStarDeps = {}): Promise<void> {
    const stdinIsTTY = deps.stdinIsTTY ?? process.stdin.isTTY;
    const stdoutIsTTY = deps.stdoutIsTTY ?? process.stdout.isTTY;
    if (!stdinIsTTY || !stdoutIsTTY) return;

    const hasBeenPromptedImpl = deps.hasBeenPromptedFn ?? hasBeenPrompted;
    if (await hasBeenPromptedImpl()) return;

    const isGhInstalledImpl = deps.isGhInstalledFn ?? isGhInstalled;
    if (!isGhInstalledImpl()) return;

    const markPromptedImpl = deps.markPromptedFn ?? markPrompted;
    await markPromptedImpl();

    const askYesNoImpl = deps.askYesNoFn ?? askYesNo;
    const approved = await askYesNoImpl('[jaw] Enjoying cli-jaw? Star it on GitHub? [Y/n] ');
    if (!approved) return;

    const starRepoImpl = deps.starRepoFn ?? starRepo;
    const star = starRepoImpl();
    if (star.ok) {
        const log = deps.logFn ?? console.log;
        log('[jaw] Thanks for the star!');
        return;
    }

    const warn = deps.warnFn ?? console.warn;
    warn(`[jaw] Could not star repository automatically: ${star.error}`);
}

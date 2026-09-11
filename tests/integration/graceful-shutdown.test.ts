import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findFreePort } from '../helpers/jaw-server.mts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const CLI_ENTRY = join(ROOT, 'dist', 'bin', 'cli-jaw.js');
const HAS_DIST = fs.existsSync(CLI_ENTRY);
const IN_CI = !!process.env['CI'];

/**
 * A missing dist is a developer-box fact and a broken job under CI: the
 * integration workflow runs npm run build before this suite precisely so that
 * dist/bin/cli-jaw.js and the assets it loads exist. Skipping there would turn
 * a failed build into a green run, which is the same shape as the #661 loss.
 * This is the api-smoke.test.ts rule applied to the file that needed it most.
 */
function requireDist(t: { skip(reason: string): void }): boolean {
    if (HAS_DIST) return true;
    if (IN_CI) {
        assert.fail('dist/bin/cli-jaw.js is missing under CI — the integration job runs "npm run build" before this suite, so this is a broken job, not a missing local build');
    }
    t.skip('dist not built; run npm run build to exercise shutdown locally');
    return false;
}

async function sleep(ms: number) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

async function isHealthy(port: number) {
    try {
        // Bounded. Without a timeout a half-open socket parks this fetch
        // indefinitely and the 30s waitForHealth loop never gets to iterate —
        // a fail-closed test that hangs is not an improvement on a green skip.
        const res = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
        return res.ok;
    } catch {
        return false;
    }
}

async function waitForHealth(port: number, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await isHealthy(port)) return;
        await sleep(250);
    }
    throw new Error(`health check timeout on port ${port}`);
}

async function waitForExit(child: ReturnType<typeof spawn>, timeoutMs = 7000) {
    return await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('process exit timeout')), timeoutMs);
        child.once('exit', (code, signal) => {
            clearTimeout(timer);
            if (typeof code === 'number') return resolve(code);
            if (signal) return resolve(128 + 9); // fallback on signal-only exit
            resolve(1);
        });
    });
}

async function runSignalCase(
    signal: NodeJS.Signals,
    seed = 0,
    signalTarget: 'parent' | 'group' = 'parent',
) {
    const home = fs.mkdtempSync(join(tmpdir(), `jaw-shutdown-it-${seed}-`));
    // A probed free port, not a random one in a fixed band: files run
    // concurrently under process isolation, so two cases could pick the same
    // number and the loser would look like a server that refused to boot.
    const port = await findFreePort();
    const child = spawn(
        process.execPath,
        [CLI_ENTRY, '--home', home, 'serve', '--port', String(port), '--no-open'],
        { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
    );

    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    try {
        try {
            await waitForHealth(port);
        } catch (error) {
            child.kill('SIGKILL');
            fs.rmSync(home, { recursive: true, force: true });
            // Under CI the server not booting IS the finding. The stderr was
            // already being captured here and then thrown away, which is why
            // every past occurrence read as an environment quirk rather than as
            // the failure it is.
            if (IN_CI) {
                throw new Error(
                    `serve failed to become healthy on port ${port} under CI (${(error as Error).message}).\n`
                    + `child stderr:\n${stderr || '(empty)'}`,
                );
            }
            return 'skipped';
        }
        const startedAt = Date.now();
        if (signalTarget === 'group' && child.pid) {
            process.kill(-child.pid, signal);
        } else {
            child.kill(signal);
        }
        const exitCode = await waitForExit(child, 8000);
        const elapsedMs = Date.now() - startedAt;

        // Graceful shutdown should finish before the force-exit safety timer.
        assert.ok(elapsedMs <= 4200, `shutdown took too long (${elapsedMs}ms)`);
        // SIGINT may return 130 (128+2) on some platforms when the process exits by signal.
        assert.ok([0, 1, 130, 143].includes(exitCode!), `unexpected exit code for ${signal}: ${exitCode}`);

        await sleep(600);
        assert.equal(await isHealthy(port), false, `port ${port} should be closed after ${signal}`);
    } finally {
        try { child.kill('SIGKILL'); } catch { /* noop */ }
        fs.rmSync(home, { recursive: true, force: true });
    }
    return 'ok';
}

test('GSI-001: serve exits within timeout on SIGTERM and closes port', async (t) => {
    if (!requireDist(t)) return;
    const result = await runSignalCase('SIGTERM', 1);
    // Unreachable under CI: runSignalCase throws there instead of reporting a
    // sentinel, so this branch is a developer-box affordance only.
    if (result === 'skipped') t.skip('server failed to start locally');
});

test('GSI-002: serve exits within timeout on SIGINT and closes port', async (t) => {
    if (!requireDist(t)) return;
    const result = await runSignalCase('SIGINT', 2, 'group');
    if (result === 'skipped') t.skip('server failed to start locally');
});

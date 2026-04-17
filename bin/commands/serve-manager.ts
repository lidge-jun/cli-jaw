/**
 * cli-jaw serve-manager — Jaw.app process manager.
 * Spawns all registered instances as child processes under Jaw.app's
 * TCC context so every child inherits Automation/Accessibility permissions.
 *
 * Internal command — invoked by jaw-launcher (Jaw.app), not by users directly.
 */
import { spawn, ChildProcess } from 'node:child_process';
import { openSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readInstances, addInstance, JawAppInstance } from '../../src/core/jawapp-instances.js';
import { getNodePath, getJawPath } from '../../src/core/instance.js';

// ─── Types ──────────────────────────────────────────

interface ManagedChild {
    instance: JawAppInstance;
    process: ChildProcess | null;
    restartCount: number;
    lastStartTime: number;
    backoffMs: number;
    timer: ReturnType<typeof setTimeout> | null;
}

// ─── State ──────────────────────────────────────────

const children = new Map<string, ManagedChild>();
let shuttingDown = false;

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const HEALTHY_UPTIME_MS = 60_000;

// ─── Helpers ────────────────────────────────────────

function childKey(inst: JawAppInstance): string {
    return `${inst.home}:${inst.port}`;
}

function log(msg: string): void {
    const ts = new Date().toISOString();
    process.stderr.write(`[serve-manager ${ts}] ${msg}\n`);
}

// ─── Spawn ──────────────────────────────────────────

function spawnInstance(mc: ManagedChild): void {
    const { instance: inst } = mc;
    const key = childKey(inst);
    const node = getNodePath();
    const jaw = getJawPath();

    const logDir = join(inst.home, 'logs');
    mkdirSync(logDir, { recursive: true });
    const stdout = openSync(join(logDir, 'jaw-serve.log'), 'a');
    const stderr = openSync(join(logDir, 'jaw-serve.err'), 'a');

    const args = [jaw, '--home', inst.home, 'serve', '--port', String(inst.port), '--no-open'];

    const child = spawn(node, args, {
        detached: false,
        stdio: ['ignore', stdout, stderr],
        env: {
            ...process.env,
            CLI_JAW_HOME: inst.home,
            CLI_JAW_VIA_APP: '1',
            CLI_JAW_RUNTIME: 'jawapp',
            PORT: String(inst.port),
        },
    });

    mc.process = child;
    mc.lastStartTime = Date.now();
    log(`spawned ${key} (PID ${child.pid})`);

    child.on('exit', (code, signal) => {
        if (shuttingDown) return;
        const uptime = Date.now() - mc.lastStartTime;
        log(`${key} exited (code=${code}, signal=${signal}, uptime=${Math.round(uptime / 1000)}s)`);
        mc.process = null;
        scheduleRestart(mc);
    });

    child.on('error', (err) => {
        log(`${key} spawn error: ${err.message}`);
        mc.process = null;
        if (!shuttingDown) scheduleRestart(mc);
    });
}

// ─── Restart with backoff ───────────────────────────

function scheduleRestart(mc: ManagedChild): void {
    if (shuttingDown) return;
    const key = childKey(mc.instance);
    const uptime = Date.now() - mc.lastStartTime;

    if (uptime > HEALTHY_UPTIME_MS) {
        mc.backoffMs = INITIAL_BACKOFF_MS;
    } else {
        mc.backoffMs = Math.min(mc.backoffMs * 2, MAX_BACKOFF_MS);
    }
    mc.restartCount++;

    log(`restarting ${key} in ${mc.backoffMs}ms (attempt #${mc.restartCount})`);
    mc.timer = setTimeout(() => {
        if (shuttingDown) return;
        spawnInstance(mc);
    }, mc.backoffMs);
}

// ─── Shutdown ───────────────────────────────────────

async function shutdownAll(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log('shutting down all instances...');

    for (const mc of children.values()) {
        if (mc.timer) clearTimeout(mc.timer);
        if (mc.process && mc.process.exitCode === null) {
            mc.process.kill('SIGTERM');
        }
    }

    // Wait up to 5s for graceful exit, then SIGKILL
    const deadline = Date.now() + 5_000;
    const alive = () =>
        [...children.values()].filter((mc) => mc.process && mc.process.exitCode === null);

    while (alive().length > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
    }

    for (const mc of alive()) {
        log(`force-killing ${childKey(mc.instance)}`);
        mc.process!.kill('SIGKILL');
    }

    log('all instances stopped');
    process.exit(0);
}

// ─── Main ───────────────────────────────────────────

log('starting...');

let instances = readInstances();

if (instances.length === 0) {
    const defaultHome = join(homedir(), '.cli-jaw');
    if (existsSync(defaultHome)) {
        log('no instances registered — adding default instance (:3457)');
        instances = addInstance(defaultHome, 3457);
    } else {
        log('no instances registered and default home missing — waiting');
        // Keep alive so Jaw.app doesn't immediately exit
        setInterval(() => {
            const fresh = readInstances();
            if (fresh.length > 0) {
                log(`instances appeared (${fresh.length}) — spawning`);
                for (const inst of fresh) {
                    const key = childKey(inst);
                    if (!children.has(key)) {
                        const mc: ManagedChild = {
                            instance: inst,
                            process: null,
                            restartCount: 0,
                            lastStartTime: 0,
                            backoffMs: INITIAL_BACKOFF_MS,
                            timer: null,
                        };
                        children.set(key, mc);
                        spawnInstance(mc);
                    }
                }
            }
        }, 5_000);
    }
}

for (const inst of instances) {
    const key = childKey(inst);
    const mc: ManagedChild = {
        instance: inst,
        process: null,
        restartCount: 0,
        lastStartTime: 0,
        backoffMs: INITIAL_BACKOFF_MS,
        timer: null,
    };
    children.set(key, mc);
    spawnInstance(mc);
}

log(`managing ${children.size} instance(s)`);

process.on('SIGTERM', () => shutdownAll());
process.on('SIGINT', () => shutdownAll());

// SIGHUP: re-read registry and spawn new / kill removed instances
process.on('SIGHUP', () => {
    log('SIGHUP received — reloading instances');
    const fresh = readInstances();
    const freshKeys = new Set(fresh.map(childKey));

    // Spawn new instances
    for (const inst of fresh) {
        const key = childKey(inst);
        if (!children.has(key)) {
            const mc: ManagedChild = {
                instance: inst,
                process: null,
                restartCount: 0,
                lastStartTime: 0,
                backoffMs: INITIAL_BACKOFF_MS,
                timer: null,
            };
            children.set(key, mc);
            spawnInstance(mc);
            log(`added ${key}`);
        }
    }

    // Kill removed instances
    for (const [key, mc] of children.entries()) {
        if (!freshKeys.has(key)) {
            log(`removing ${key}`);
            if (mc.timer) clearTimeout(mc.timer);
            if (mc.process && mc.process.exitCode === null) {
                mc.process.kill('SIGTERM');
            }
            children.delete(key);
        }
    }
});

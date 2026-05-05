import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { clearDurableBrowserRuntimeOwner, readDurableBrowserRuntimeOwner } from './runtime-owner-store.js';
import type { BrowserRuntimeOwner, BrowserRuntimeStatus } from './runtime-owner.js';

export interface BrowserRuntimeOrphanCandidate {
    pid: number | null;
    port: number | null;
    userDataDir: string | null;
    headless: boolean | null;
    reason: 'durable-owner-not-current' | 'process-not-running' | 'ownership-proof-failed' | 'current-runtime';
    closeable: boolean;
    action: 'none' | 'close-process' | 'prune-record';
}

export interface BrowserRuntimeCleanupResult {
    ok: boolean;
    dryRun: boolean;
    closed: number;
    pruned: number;
    candidates: BrowserRuntimeOrphanCandidate[];
}

function readProcessCommandLine(pid: number): Promise<string | null> {
    if (process.platform === 'win32') {
        return new Promise((resolve) => {
            execFile('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `(Get-CimInstance Win32_Process -Filter "ProcessId = ${Math.trunc(pid)}").CommandLine`,
            ], (error, stdout) => resolve(error ? null : stdout.trim() || null));
        });
    }
    if (process.platform === 'linux') {
        try {
            return Promise.resolve(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim());
        } catch {
            return Promise.resolve(null);
        }
    }
    return new Promise((resolve) => {
        execFile('ps', ['-p', String(pid), '-o', 'command='], (error, stdout) => {
            resolve(error ? null : stdout.trim() || null);
        });
    });
}

export function commandLineMatchesDurableRuntimeOwner(owner: BrowserRuntimeOwner, command: string | null): boolean {
    if (!command || owner.ownership !== 'jaw-owned') return false;
    if (!owner.port || !owner.userDataDir) return false;
    if (command.includes('--type=')) return false;
    return commandLineHasExactFlagValue(command, 'remote-debugging-port', String(owner.port))
        && commandLineHasExactFlagValue(command, 'user-data-dir', owner.userDataDir);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commandLineHasExactFlagValue(command: string, flag: string, expected: string): boolean {
    const pattern = new RegExp(`(?:^|\\s)--${escapeRegExp(flag)}=${escapeRegExp(expected)}(?:\\s|$)`);
    return pattern.test(command);
}

function isCurrentRuntime(owner: BrowserRuntimeOwner, current: BrowserRuntimeStatus | null | undefined): boolean {
    if (!current || current.ownership !== 'jaw-owned') return false;
    return owner.pid === current.pid && owner.port === current.port && owner.userDataDir === current.userDataDir;
}

export async function inspectBrowserRuntimeOrphans(
    currentRuntime?: BrowserRuntimeStatus | null,
): Promise<BrowserRuntimeOrphanCandidate[]> {
    const owner = readDurableBrowserRuntimeOwner();
    if (!owner || owner.ownership !== 'jaw-owned') return [];
    if (isCurrentRuntime(owner, currentRuntime)) {
        return [{
            pid: owner.pid,
            port: owner.port,
            userDataDir: owner.userDataDir,
            headless: owner.headless,
            reason: 'current-runtime',
            closeable: false,
            action: 'none',
        }];
    }
    if (!owner.pid) {
        return [{
            pid: owner.pid,
            port: owner.port,
            userDataDir: owner.userDataDir,
            headless: owner.headless,
            reason: 'process-not-running',
            closeable: false,
            action: 'prune-record',
        }];
    }
    const command = await readProcessCommandLine(owner.pid);
    if (!command) {
        return [{
            pid: owner.pid,
            port: owner.port,
            userDataDir: owner.userDataDir,
            headless: owner.headless,
            reason: 'process-not-running',
            closeable: false,
            action: 'prune-record',
        }];
    }
    const closeable = commandLineMatchesDurableRuntimeOwner(owner, command);
    return [{
        pid: owner.pid,
        port: owner.port,
        userDataDir: owner.userDataDir,
        headless: owner.headless,
        reason: closeable ? 'durable-owner-not-current' : 'ownership-proof-failed',
        closeable,
        action: closeable ? 'close-process' : 'none',
    }];
}

export async function cleanupBrowserRuntimeOrphans(options: {
    close?: boolean;
    force?: boolean;
    currentRuntime?: BrowserRuntimeStatus | null;
} = {}): Promise<BrowserRuntimeCleanupResult> {
    const candidates = await inspectBrowserRuntimeOrphans(options.currentRuntime);
    const dryRun = !(options.close === true && options.force === true);
    let closed = 0;
    let pruned = 0;

    if (!dryRun) {
        for (const candidate of candidates) {
            if (candidate.action === 'close-process' && candidate.closeable && candidate.pid) {
                try {
                    process.kill(candidate.pid, 'SIGTERM');
                    closed++;
                    clearDurableBrowserRuntimeOwner(candidate);
                } catch {
                    // Treat vanished processes as stale records.
                    if (clearDurableBrowserRuntimeOwner(candidate)) pruned++;
                }
            } else if (candidate.action === 'prune-record') {
                if (clearDurableBrowserRuntimeOwner(candidate)) pruned++;
            }
        }
    }

    return { ok: true, dryRun, closed, pruned, candidates };
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildServicePath } from './runtime-path.js';

export interface RejectedCliCandidate {
    path: string;
    reason: string;
}

export interface CliDetection {
    available: boolean;
    path: string | null;
    rejected?: RejectedCliCandidate[];
}

function uniqueLines(raw: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
        const candidate = line.trim();
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        out.push(candidate);
    }
    return out;
}

const BUN_DEPRIO_CLIS = new Set(['claude']);

function normalizedPath(filePath: string): string {
    return path.normalize(filePath);
}

function isPathInside(candidate: string, dir: string): boolean {
    const relative = path.relative(dir, candidate);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function isBunBinCandidate(candidate: string, homeDir = os.homedir()): boolean {
    const normalized = normalizedPath(candidate);
    return isPathInside(normalized, path.join(homeDir, '.bun', 'bin'));
}

function isManagedNodeCandidate(candidate: string, homeDir = os.homedir()): boolean {
    const normalized = normalizedPath(candidate);
    const candidateDir = path.dirname(normalized);
    const preferredDirs = [
        path.dirname(process.execPath),
        path.join(homeDir, '.local', 'bin'),
        path.join(homeDir, '.claude', 'local', 'bin'),
        path.join(homeDir, 'bin'),
        path.join(homeDir, '.npm-global', 'bin'),
        path.join(homeDir, '.yarn', 'bin'),
        path.join(homeDir, '.pnpm'),
        path.join(homeDir, '.volta', 'bin'),
    ];
    if (preferredDirs.some((dir) => candidateDir === path.normalize(dir))) return true;

    const managedRoots = [
        path.join(homeDir, '.nvm', 'versions', 'node'),
        path.join(homeDir, '.local', 'share', 'fnm', 'node-versions'),
        path.join(homeDir, '.fnm', 'node-versions'),
    ];
    return managedRoots.some((root) => isPathInside(normalized, path.normalize(root)));
}

function candidatePriority(cliName: string, candidate: string, index: number, homeDir = os.homedir()): number {
    if (!BUN_DEPRIO_CLIS.has(cliName)) return index;
    if (isManagedNodeCandidate(candidate, homeDir)) return index;
    if (isBunBinCandidate(candidate, homeDir)) return 10_000 + index;
    return 5_000 + index;
}

export function prioritizeCliCandidates(
    cliName: string,
    candidates: string[],
    homeDir = os.homedir(),
): string[] {
    if (!BUN_DEPRIO_CLIS.has(cliName)) return candidates;
    return candidates
        .map((candidate, index) => ({ candidate, priority: candidatePriority(cliName, candidate, index, homeDir) }))
        .sort((a, b) => a.priority - b.priority)
        .map((entry) => entry.candidate);
}

function readHead(filePath: string, length = 64): Buffer {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(length);
        const bytesRead = fs.readSync(fd, buffer, 0, length, 0);
        return buffer.subarray(0, bytesRead);
    } finally {
        fs.closeSync(fd);
    }
}

function hasKnownExecutableMagic(head: Buffer): boolean {
    if (head.length >= 4 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return true; // ELF
    if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) return true; // PE/MZ
    if (head.length < 4) return false;
    const magic = head.subarray(0, 4).toString('hex');
    return [
        'feedface',
        'cefaedfe',
        'feedfacf',
        'cffaedfe',
        'cafebabe',
        'bebafeca',
    ].includes(magic);
}

export function isSpawnableCliFile(filePath: string, platform: NodeJS.Platform = process.platform): { ok: boolean; reason?: string } {
    if (platform === 'win32') return { ok: true };

    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return { ok: false, reason: 'not a regular file' };
        if ((stat.mode & 0o111) === 0) return { ok: false, reason: 'not executable' };
        const head = readHead(filePath);
        if (head.length === 0) return { ok: false, reason: 'empty file' };
        if (head[0] === 0x23 && head[1] === 0x21) return { ok: true }; // #!
        if (hasKnownExecutableMagic(head)) return { ok: true };
        if (head.includes(0)) return { ok: true };
        return { ok: false, reason: 'text file without shebang' };
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return { ok: false, reason: code || (error as Error).message };
    }
}

export function selectSpawnableCliPath(
    candidates: string[],
    platform: NodeJS.Platform = process.platform,
): CliDetection {
    const rejected: RejectedCliCandidate[] = [];
    for (const candidate of candidates) {
        const check = isSpawnableCliFile(candidate, platform);
        if (check.ok) {
            return {
                available: true,
                path: candidate,
                ...(rejected.length ? { rejected } : {}),
            };
        }
        rejected.push({ path: candidate, reason: check.reason || 'not spawnable' });
    }
    return {
        available: false,
        path: null,
        ...(rejected.length ? { rejected } : {}),
    };
}

export function detectCliBinary(name: string, seedPath = process.env["PATH"] || ''): CliDetection {
    if (!/^[a-z0-9_-]+$/i.test(name)) return { available: false, path: null };
    try {
        const cmd = process.platform === 'win32' ? 'where' : 'which';
        const args = process.platform === 'win32' ? [name] : ['-a', name];
        const raw = execFileSync(cmd, args, {
            encoding: 'utf8',
            timeout: 3000,
            env: {
                ...process.env,
                PATH: buildServicePath(seedPath),
            },
        }).trim();
        return selectSpawnableCliPath(prioritizeCliCandidates(name, uniqueLines(raw)));
    } catch {
        return { available: false, path: null };
    }
}

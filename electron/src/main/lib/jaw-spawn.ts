import { spawn, type ChildProcess, execFileSync } from 'node:child_process';
import { existsSync, statSync, readdirSync, accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RingBuffer } from './ring-buffer.js';

let pathFixed = false;
async function ensureFixedPath(): Promise<void> {
  if (pathFixed) return;
  pathFixed = true;
  try {
    const mod = await import('fix-path');
    const fn = (mod as unknown as { default?: () => void }).default ?? (mod as unknown as () => void);
    if (typeof fn === 'function') fn();
  } catch {
    // fix-path is optional; ignore in dev
  }
}

function isExecutable(p: string): boolean {
  try {
    const st = statSync(p);
    if (!st.isFile()) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function whichJaw(): string | null {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['jaw'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const first = out.split(/\r?\n/)[0]?.trim();
    if (first && isExecutable(first)) return first;
  } catch {
    // not found
  }
  return null;
}

function expandNvmCandidates(): string[] {
  const out: string[] = [];
  const nvmDir = join(homedir(), '.nvm', 'versions', 'node');
  if (!existsSync(nvmDir)) return out;
  try {
    for (const ver of readdirSync(nvmDir)) {
      out.push(join(nvmDir, ver, 'bin', 'jaw'));
    }
  } catch {
    // ignore
  }
  return out;
}

function buildCandidateList(): string[] {
  const cands: string[] = [];
  if (process.env.JAW_BIN) cands.push(process.env.JAW_BIN);
  cands.push('/opt/homebrew/bin/jaw');
  cands.push('/usr/local/bin/jaw');
  cands.push(...expandNvmCandidates());
  cands.push(join(homedir(), '.volta', 'bin', 'jaw'));
  cands.push(join(homedir(), '.fnm', 'aliases', 'default', 'bin', 'jaw'));
  cands.push(join(homedir(), '.fnm', 'current', 'bin', 'jaw'));
  return cands;
}

export interface FindResult {
  path: string | null;
  searched: string[];
}

export async function findJawBinary(): Promise<FindResult> {
  await ensureFixedPath();
  const searched: string[] = [];

  if (process.env.JAW_BIN) {
    searched.push(`$JAW_BIN=${process.env.JAW_BIN}`);
    if (isExecutable(process.env.JAW_BIN)) {
      return { path: process.env.JAW_BIN, searched };
    }
  }

  const w = whichJaw();
  searched.push(`which jaw → ${w ?? '(not found)'}`);
  if (w) return { path: w, searched };

  for (const c of buildCandidateList()) {
    if (searched.includes(c)) continue;
    searched.push(c);
    if (isExecutable(c)) return { path: c, searched };
  }

  return { path: null, searched };
}

export interface SpawnOptions {
  port: number;
  ringBuffer: RingBuffer;
  env?: NodeJS.ProcessEnv;
}

export function spawnJawDashboard(
  binary: string,
  opts: SpawnOptions,
): ChildProcess {
  const child = spawn(binary, ['dashboard', 'serve', '--port', String(opts.port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(opts.env ?? {}) },
    detached: false,
  });
  child.stdout?.on('data', (d) => opts.ringBuffer.append(d));
  child.stderr?.on('data', (d) => opts.ringBuffer.append(d));
  return child;
}

export async function gracefulShutdown(
  child: ChildProcess,
  timeoutMs = 5000,
): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once('exit', finish);
    try {
      child.kill('SIGTERM');
    } catch {
      finish();
      return;
    }
    setTimeout(() => {
      if (done) return;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      finish();
    }, timeoutMs);
  });
}

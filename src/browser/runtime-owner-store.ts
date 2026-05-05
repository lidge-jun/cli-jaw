import fs from 'node:fs';
import { join } from 'node:path';
import { JAW_HOME } from '../core/config.js';
import type { BrowserRuntimeOwner } from './runtime-owner.js';

const RUNTIME_OWNER_FILE = join(JAW_HOME, 'browser-runtime-owner.json');

type BrowserRuntimeOwnerMatch = Pick<BrowserRuntimeOwner, 'pid' | 'port' | 'userDataDir'>;

function isRuntimeOwner(value: unknown): value is BrowserRuntimeOwner {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return (record["ownership"] === 'jaw-owned' || record["ownership"] === 'external')
        && (typeof record["pid"] === 'number' || record["pid"] === null)
        && (typeof record["port"] === 'number' || record["port"] === null)
        && (typeof record["userDataDir"] === 'string' || record["userDataDir"] === null);
}

export function readDurableBrowserRuntimeOwner(): BrowserRuntimeOwner | null {
    try {
        if (!fs.existsSync(RUNTIME_OWNER_FILE)) return null;
        const parsed = JSON.parse(fs.readFileSync(RUNTIME_OWNER_FILE, 'utf8')) as unknown;
        return isRuntimeOwner(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function writeDurableBrowserRuntimeOwner(owner: BrowserRuntimeOwner): void {
    if (owner.ownership !== 'jaw-owned') return;
    fs.mkdirSync(JAW_HOME, { recursive: true });
    fs.writeFileSync(RUNTIME_OWNER_FILE, `${JSON.stringify(owner, null, 2)}\n`);
}

export function clearDurableBrowserRuntimeOwner(expected?: BrowserRuntimeOwnerMatch | null): boolean {
    const current = readDurableBrowserRuntimeOwner();
    if (!current) return false;
    if (expected && (
        current.pid !== expected.pid ||
        current.port !== expected.port ||
        current.userDataDir !== expected.userDataDir
    )) {
        return false;
    }
    try {
        fs.rmSync(RUNTIME_OWNER_FILE, { force: true });
        return true;
    } catch {
        return false;
    }
}

export function getBrowserRuntimeOwnerFile(): string {
    return RUNTIME_OWNER_FILE;
}

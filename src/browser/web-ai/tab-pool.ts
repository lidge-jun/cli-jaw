import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { JAW_HOME } from '../../core/config.js';
import { listTabs } from '../connection.js';
import type { WebAiVendor } from './types.js';

interface PooledTab {
    targetId: string;
    url?: string;
    pooledAt: number;
}

const POOL_FILE = join(JAW_HOME, 'browser-web-ai-tab-pool.json');
const POOL_MAX_AGE_MS = 5 * 60 * 1000;
const POOL_MAX_SIZE = 3;
const pool = new Map<WebAiVendor, PooledTab[]>();
let loaded = false;

function loadPool(): void {
    if (loaded) return;
    loaded = true;
    if (!existsSync(POOL_FILE)) return;
    try {
        const parsed = JSON.parse(readFileSync(POOL_FILE, 'utf8')) as { pool?: Record<string, PooledTab[]> };
        for (const [vendor, list] of Object.entries(parsed.pool || {})) {
            if (Array.isArray(list)) pool.set(vendor as WebAiVendor, list.filter(entry => entry?.targetId));
        }
    } catch {
        pool.clear();
    }
}

function savePool(): void {
    mkdirSync(dirname(POOL_FILE), { recursive: true });
    writeFileSync(POOL_FILE, `${JSON.stringify({ pool: Object.fromEntries(pool.entries()) }, null, 2)}\n`);
}

export function poolTab(vendor: WebAiVendor, targetId: string | null | undefined, url?: string): void {
    loadPool();
    if (!vendor || !targetId) return;
    const current = pool.get(vendor) || [];
    const next = current.filter(tab => tab.targetId !== targetId);
    next.push({ targetId, url, pooledAt: Date.now() });
    while (next.length > POOL_MAX_SIZE) next.shift();
    pool.set(vendor, next);
    savePool();
}

export async function getPooledTab(port: number, vendor: WebAiVendor): Promise<{ targetId: string; url?: string } | null> {
    loadPool();
    const list = pool.get(vendor);
    if (!list?.length) return null;
    const now = Date.now();
    const liveTargetIds = new Set((await listTabs(port)).map(tab => tab.targetId));
    for (const entry of list) {
        if (now - entry.pooledAt > POOL_MAX_AGE_MS) continue;
        if (!liveTargetIds.has(entry.targetId)) continue;
        const survivors = list.filter(tab => tab.targetId !== entry.targetId && now - tab.pooledAt <= POOL_MAX_AGE_MS);
        if (survivors.length > 0) pool.set(vendor, survivors);
        else pool.delete(vendor);
        savePool();
        return { targetId: entry.targetId, url: entry.url };
    }
    pool.delete(vendor);
    savePool();
    return null;
}

export function unpoolTab(vendor: WebAiVendor, targetId: string | null | undefined): void {
    loadPool();
    if (!targetId) return;
    const list = pool.get(vendor);
    if (!list) return;
    const next = list.filter(tab => tab.targetId !== targetId);
    if (next.length > 0) pool.set(vendor, next);
    else pool.delete(vendor);
    savePool();
}

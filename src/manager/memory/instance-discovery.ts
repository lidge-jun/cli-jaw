import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { homedir } from 'node:os';
import { loadDashboardRegistry } from '../registry.js';
import { defaultHomeForPort } from '../lifecycle-helpers.js';
import { resolveStructuredIndexDbPath } from '../../memory/shared.js';
import type { DashboardRegistry } from '../types.js';
import type { InstanceMemoryRef, ScanItemForFederation } from './types.js';

const BLACKLIST_PATTERNS: RegExp[] = [
    /^\.cli-jaw-manager-/,
    /^\.cli-jaw-dashboard$/,
    /^\.cli-jaw-smoke-/,
    /\.bak\./,
];

function isBlacklisted(homePath: string): boolean {
    return BLACKLIST_PATTERNS.some(rx => rx.test(basename(homePath)));
}

function resolveHomeForInstance(
    port: number,
    baseHome: string,
    override?: string | null,
): { path: string; source: 'profile' | 'default-port' } {
    if (override && typeof override === 'string' && override.trim()) {
        return { path: override, source: 'profile' };
    }
    return { path: defaultHomeForPort(port, baseHome), source: 'default-port' };
}

function buildRefs(
    registry: DashboardRegistry,
    baseHome: string,
    overrides: Map<number, string> | undefined,
): InstanceMemoryRef[] {
    const out: InstanceMemoryRef[] = [];
    for (const [portKey, info] of Object.entries(registry.instances)) {
        const port = Number(portKey);
        if (!Number.isFinite(port)) continue;
        const override = overrides?.get(port) ?? null;
        const home = resolveHomeForInstance(port, baseHome, override);
        if (isBlacklisted(home.path)) continue;
        const dbPath = resolveStructuredIndexDbPath(home.path);
        let hasDb = false;
        try {
            hasDb = existsSync(dbPath) && statSync(dbPath).isFile();
        } catch {
            hasDb = false;
        }
        out.push({
            instanceId: String(port),
            homePath: home.path,
            homeSource: home.source,
            port,
            label: info.label ?? null,
            dbPath,
            hasDb,
        });
    }
    return out;
}

export function listSearchableInstances(opts: { baseHome?: string } = {}): InstanceMemoryRef[] {
    const { registry } = loadDashboardRegistry();
    const baseHome = opts.baseHome ?? homedir();
    return buildRefs(registry, baseHome, undefined);
}

export function listSearchableInstancesAt(
    registry: DashboardRegistry,
    baseHome: string,
    overrides?: Map<number, string>,
): InstanceMemoryRef[] {
    return buildRefs(registry, baseHome, overrides);
}

export function listSearchableInstancesFromScan(
    scanItems: ScanItemForFederation[],
    opts: { baseHome?: string } = {},
): InstanceMemoryRef[] {
    const { registry } = loadDashboardRegistry();
    const baseHome = opts.baseHome ?? homedir();
    const overrides = new Map<number, string>();
    for (const item of scanItems) {
        const port = item.port;
        if (!Number.isFinite(port)) continue;
        let resolved: string | null = null;
        if (item.profileId) {
            const profile = registry.profiles?.[item.profileId as keyof typeof registry.profiles];
            if (profile && typeof profile.homePath === 'string' && profile.homePath.trim()) {
                resolved = profile.homePath;
            }
        }
        if (!resolved && item.homeDisplay && item.homeDisplay.trim()) {
            resolved = item.homeDisplay;
        }
        if (resolved) overrides.set(port, resolved);
    }
    return buildRefs(registry, baseHome, overrides);
}

export type { ScanItemForFederation };

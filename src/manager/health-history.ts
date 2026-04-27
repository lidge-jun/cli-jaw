/**
 * 10.7.1 — Health history ring buffer.
 *
 * Memory-only by default. Disk persistence is opt-in via
 * `JAW_DASHBOARD_HEALTH_PERSIST=1` (resolved at construction). Bytes never
 * land in `manager-instances.json` — the registry stays UI/persistence
 * focused per 10.6 design.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { DashboardInstanceStatus } from './types.js';

const DEFAULT_RETENTION = 50;
const DEFAULT_FILENAME = 'manager-health-history.json';

export type HealthEvent = {
    port: number;
    at: string;
    status: DashboardInstanceStatus;
    reason: string | null;
    versionSeen: string | null;
};

export type HealthHistoryOptions = {
    retentionPerPort?: number;
    persistPath?: string | null;
};

export type HealthHistory = {
    record(event: HealthEvent): void;
    list(port: number, limit?: number): HealthEvent[];
    listAll(): HealthEvent[];
    purge(olderThanMs: number): void;
    snapshot(): Record<string, HealthEvent[]>;
};

function managerHome(): string {
    const home = process.env.CLI_JAW_HOME || join(homedir(), '.cli-jaw');
    return resolve(home.replace(/^~(?=\/|$)/, homedir()));
}

function defaultPersistPath(): string | null {
    if (process.env.JAW_DASHBOARD_HEALTH_PERSIST === '1') {
        return join(managerHome(), DEFAULT_FILENAME);
    }
    return null;
}

function isHealthEvent(value: unknown): value is HealthEvent {
    if (!value || typeof value !== 'object') return false;
    const event = value as Record<string, unknown>;
    return (
        typeof event.port === 'number'
        && typeof event.at === 'string'
        && typeof event.status === 'string'
        && (event.reason === null || typeof event.reason === 'string')
        && (event.versionSeen === null || typeof event.versionSeen === 'string')
    );
}

function loadFromDisk(path: string): Map<number, HealthEvent[]> {
    const map = new Map<number, HealthEvent[]>();
    if (!existsSync(path)) return map;
    try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        if (!raw || typeof raw !== 'object') return map;
        for (const [key, value] of Object.entries(raw)) {
            const port = Number(key);
            if (!Number.isInteger(port) || !Array.isArray(value)) continue;
            const events = value.filter(isHealthEvent);
            if (events.length > 0) map.set(port, events);
        }
    } catch {
        // Corrupt file — start fresh; never throw on history load.
    }
    return map;
}

function writeToDisk(path: string, buffers: Map<number, HealthEvent[]>): void {
    try {
        mkdirSync(dirname(path), { recursive: true });
        const out: Record<string, HealthEvent[]> = {};
        for (const [port, events] of buffers.entries()) out[String(port)] = events;
        writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
    } catch {
        // Disk failure is non-fatal — in-memory ring buffer continues.
    }
}

export function createHealthHistory(options: HealthHistoryOptions = {}): HealthHistory {
    const retention = Math.max(1, options.retentionPerPort ?? DEFAULT_RETENTION);
    const persistPath = options.persistPath === undefined
        ? defaultPersistPath()
        : options.persistPath;
    const buffers = persistPath ? loadFromDisk(persistPath) : new Map<number, HealthEvent[]>();

    function record(event: HealthEvent): void {
        const list = buffers.get(event.port) || [];
        list.push(event);
        while (list.length > retention) list.shift();
        buffers.set(event.port, list);
        if (persistPath) writeToDisk(persistPath, buffers);
    }

    function list(port: number, limit?: number): HealthEvent[] {
        const events = buffers.get(port) || [];
        if (limit && limit > 0 && events.length > limit) {
            return events.slice(events.length - limit);
        }
        return [...events];
    }

    function listAll(): HealthEvent[] {
        const all: HealthEvent[] = [];
        for (const events of buffers.values()) all.push(...events);
        return all.sort((a, b) => a.at.localeCompare(b.at));
    }

    function purge(olderThanMs: number): void {
        const cutoff = Date.now() - olderThanMs;
        for (const [port, events] of buffers.entries()) {
            const kept = events.filter(event => Date.parse(event.at) >= cutoff);
            if (kept.length === 0) buffers.delete(port);
            else buffers.set(port, kept);
        }
        if (persistPath) writeToDisk(persistPath, buffers);
    }

    function snapshot(): Record<string, HealthEvent[]> {
        const out: Record<string, HealthEvent[]> = {};
        for (const [port, events] of buffers.entries()) out[String(port)] = [...events];
        return out;
    }

    return { record, list, listAll, purge, snapshot };
}

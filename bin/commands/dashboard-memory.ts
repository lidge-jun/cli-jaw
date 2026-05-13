import { parseArgs } from 'node:util';
import { DASHBOARD_DEFAULT_PORT } from '../../src/manager/constants.js';

function dashboardPort(): number {
    const fromEnv = Number(process.env["DASHBOARD_PORT"]);
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : Number(DASHBOARD_DEFAULT_PORT);
}

async function callDashboard<T>(path: string): Promise<T> {
    const port = dashboardPort();
    const url = `http://127.0.0.1:${port}/api/dashboard/memory${path}`;
    let res: Response;
    try {
        res = await fetch(url, { headers: { host: `127.0.0.1:${port}` } });
    } catch (err) {
        throw new Error(`dashboard memory unreachable at :${port} — run \`jaw dashboard serve\` first. (${(err as Error).message})`);
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`dashboard memory ${path} → ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
}

interface FederatedHitResponse {
    instanceId: string;
    instanceLabel: string | null;
    relpath: string;
    source_start_line: number;
    snippet?: string;
    content?: string;
}

interface SearchResponse {
    hits: FederatedHitResponse[];
    warnings: Array<{ instanceId: string; code: string; message: string }>;
    instancesQueried: number;
    instancesSucceeded: number;
}

function formatSearchResult(data: SearchResponse): string {
    const lines: string[] = [];
    lines.push(`# ${data.hits.length} hits across ${data.instancesSucceeded}/${data.instancesQueried} instances`);
    for (const hit of data.hits) {
        const label = hit.instanceLabel ? ` (${hit.instanceLabel})` : '';
        lines.push(`\n[${hit.instanceId}${label}] ${hit.relpath}:${hit.source_start_line}`);
        lines.push(hit.snippet || (hit.content || '').slice(0, 200));
    }
    if (data.warnings.length) {
        lines.push(`\n--- warnings ---`);
        for (const w of data.warnings) lines.push(`[${w.instanceId}] ${w.code}: ${w.message}`);
    }
    return lines.join('\n');
}

function printHelp(): void {
    console.log(`
  jaw dashboard memory — L2 cross-instance memory search (read-only)

  Usage:
    jaw dashboard memory search "<query>" [--instance <id,id>] [--limit N]
    jaw dashboard memory read <instanceId>:<relpath>
    jaw dashboard memory instances
    jaw dashboard memory list

  Options:
    --instance <ids>   comma-separated instance IDs to restrict the search
    --limit <N>        global result cap (max 200, default 50)
    --json             machine-readable JSON
    --port <port>      dashboard port (env DASHBOARD_PORT or default ${DASHBOARD_DEFAULT_PORT})

  Read-only. Companion to \`jaw memory\` (L1, instance-local r/w).
`);
}

export async function handleMemory(argvFromSwitch: string[]): Promise<void> {
    if (!argvFromSwitch.length || argvFromSwitch[0] === '--help' || argvFromSwitch[0] === '-h') {
        printHelp();
        return;
    }
    const sub = argvFromSwitch[0]!;
    const rest = argvFromSwitch.slice(1);
    const { values, positionals } = parseArgs({
        args: rest,
        options: {
            instance: { type: 'string' },
            limit: { type: 'string' },
            json: { type: 'boolean', default: false },
            port: { type: 'string' },
        },
        strict: false,
        allowPositionals: true,
    });
    if (values.port) process.env["DASHBOARD_PORT"] = String(values.port);

    try {
        switch (sub) {
            case 'search': {
                const q = positionals.join(' ').trim();
                if (!q) { console.error('  ❌ query required'); process.exit(1); }
                const qs = new URLSearchParams({ q });
                if (values.instance) qs.set('instance', String(values.instance));
                if (values.limit) qs.set('limit', String(values.limit));
                const result = await callDashboard<SearchResponse>(`/search?${qs.toString()}`);
                console.log(values.json ? JSON.stringify(result, null, 2) : formatSearchResult(result));
                return;
            }
            case 'instances':
            case 'list': {
                const result = await callDashboard<{
                    ok: boolean;
                    instances: Array<{ instanceId: string; label: string | null; homePath: string; homeSource: string; hasDb: boolean }>;
                }>('/instances');
                if (values.json) { console.log(JSON.stringify(result, null, 2)); return; }
                for (const i of result.instances) {
                    console.log(`[${i.instanceId}] ${i.label || '(no label)'} — ${i.homePath} (${i.homeSource}) ${i.hasDb ? '✓' : '✗ no db'}`);
                }
                return;
            }
            case 'read': {
                const arg = positionals[0] || '';
                const sep = arg.indexOf(':');
                if (sep < 0) { console.error('  ❌ expected <instanceId>:<relpath>'); process.exit(1); }
                const instance = arg.slice(0, sep);
                const path = arg.slice(sep + 1);
                const result = await callDashboard<{ ok: boolean; content: string; path: string }>(
                    `/read?instance=${encodeURIComponent(instance)}&path=${encodeURIComponent(path)}`
                );
                console.log(values.json ? JSON.stringify(result, null, 2) : result.content);
                return;
            }
            default:
                console.error(`  ❌ unknown subcommand: ${sub}`);
                printHelp();
                process.exit(1);
        }
    } catch (err) {
        console.error(`  ❌ ${(err as Error).message}`);
        process.exit(1);
    }
}

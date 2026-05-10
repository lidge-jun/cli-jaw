import { spawn } from 'node:child_process';
import { isReadonlyCliQueryAllowed } from './policy.js';
import type { JawCeoStore } from './store.js';
import type { JawCeoToolResult } from './types.js';

const MAX_CLI_OUTPUT_BYTES = 24_000;

export function nowIso(now: () => Date): string {
    return now().toISOString();
}

export function isPositivePort(value: unknown): value is number {
    return Number.isInteger(value) && Number(value) > 0 && Number(value) < 65536;
}

export function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return JSON.stringify({ error: 'unserializable' });
    }
}

export function auditTool<T>(
    store: JawCeoStore,
    input: {
        tool: string;
        ok: boolean;
        message: string;
        data?: T | undefined;
        code?: string | undefined;
        port?: number | undefined;
        sourceLabels?: string[] | undefined;
        untrustedText?: string | undefined;
        kind?: 'tool' | 'policy' | 'lifecycle' | 'completion' | 'docs_edit' | undefined;
        meta?: Record<string, unknown> | undefined;
    },
): JawCeoToolResult<T> {
    const audit = store.appendAudit({
        kind: input.kind || 'tool',
        action: input.tool,
        ok: input.ok,
        message: input.message,
        ...(input.port !== undefined ? { port: input.port } : {}),
        ...(input.meta !== undefined ? { meta: input.meta } : {}),
    });
    if (input.ok) {
        return {
            ok: true,
            tool: input.tool,
            ...(input.data !== undefined ? { data: input.data } : {}),
            auditId: audit.id,
            sourceLabels: input.sourceLabels || [],
            ...(input.untrustedText !== undefined ? { untrustedText: input.untrustedText } : {}),
        };
    }
    return {
        ok: false,
        tool: input.tool,
        error: {
            code: input.code || 'tool_failed',
            message: input.message,
        },
        auditId: audit.id,
        sourceLabels: input.sourceLabels || [],
        ...(input.untrustedText !== undefined ? { untrustedText: input.untrustedText } : {}),
    };
}

export async function runReadonlyCli(command: string, cwd: string): Promise<string> {
    if (!isReadonlyCliQueryAllowed(command)) {
        throw Object.assign(new Error('query command is not in the read-only allowlist'), { code: 'readonly_query_denied' });
    }
    const [bin, ...args] = command.trim().split(/\s+/);
    if (!bin) throw Object.assign(new Error('empty command'), { code: 'readonly_query_empty' });
    return await new Promise((resolve, reject) => {
        const child = spawn(bin, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
        });
        const chunks: Buffer[] = [];
        const errors: Buffer[] = [];
        let bytes = 0;
        child.stdout.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes <= MAX_CLI_OUTPUT_BYTES) chunks.push(chunk);
        });
        child.stderr.on('data', (chunk: Buffer) => {
            if (Buffer.concat(errors).length < 4_000) errors.push(chunk);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            const output = Buffer.concat(chunks).toString('utf8');
            const stderr = Buffer.concat(errors).toString('utf8');
            if (code !== 0) {
                reject(Object.assign(new Error(stderr || `${command} exited ${code}`), { code: 'readonly_query_failed' }));
                return;
            }
            resolve(bytes > MAX_CLI_OUTPUT_BYTES ? `${output}\n[truncated]` : output);
        });
    });
}

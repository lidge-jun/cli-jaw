// ─── Codex AppServer JSON-RPC Client ─────────────────
// Communicates with `codex app-server --listen stdio://`
// over newline-delimited JSON-RPC (lite — no "jsonrpc" key in responses).

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { createInterface, type Interface as ReadlineInterface } from 'readline';

export interface CodexAppClientOptions {
    binary?: string;
    workDir?: string;
    env?: NodeJS.ProcessEnv;
    model?: string;
    effort?: string;
}

export class CodexAppClient extends EventEmitter {
    proc: ChildProcess | null = null;
    threadId: string | null = null;

    private binary: string;
    private workDir: string;
    private spawnEnv: NodeJS.ProcessEnv;
    private model: string;
    private effort: string;
    private nextId = 1;
    private pending = new Map<number, {
        resolve: (result: unknown) => void;
        reject: (err: Error) => void;
    }>();
    private rl: ReadlineInterface | null = null;
    private cleaned = false;

    constructor(options: CodexAppClientOptions = {}) {
        super();
        this.binary = options.binary || 'codex';
        this.workDir = options.workDir || process.cwd();
        this.spawnEnv = options.env || process.env;
        this.model = options.model || 'gpt-5.4';
        this.effort = options.effort || 'medium';
    }

    spawn(): void {
        this.proc = spawn(this.binary, ['app-server', '--listen', 'stdio://'], {
            cwd: this.workDir,
            env: this.spawnEnv,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.rl = createInterface({ input: this.proc.stdout! });
        this.rl.on('line', (line) => this.handleLine(line));
        this.rl.on('error', () => {});

        this.proc.stderr?.on('data', (chunk: Buffer) => {
            this.emit('stderr', chunk.toString());
        });

        this.proc.on('error', (err) => this.emit('error', err));
        this.proc.on('exit', (code, signal) => {
            this.rejectAllPending('Process exited');
            this.emit('exit', code, signal);
        });
    }

    async initialize(): Promise<unknown> {
        const result = await this.request('initialize', {
            clientInfo: {
                name: 'cli_jaw_codex_app_server',
                title: null,
                version: '1.0.0',
            },
            capabilities: {
                experimentalApi: true,
                optOutNotificationMethods: [
                    'remoteControl/status/changed',
                    'mcpServer/startupStatus/updated',
                ],
            },
        });
        this.notify('initialized', {});
        return result;
    }

    async startThread(options: {
        instructions?: string;
        cwd?: string;
    } = {}): Promise<string> {
        const result = await this.request('thread/start', {
            model: this.model,
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
            cwd: options.cwd || this.workDir,
            config: this.reasoningConfig(),
            ...(options.instructions ? { baseInstructions: options.instructions } : {}),
        }) as { thread: { id: string } };
        this.threadId = result.thread.id;
        return this.threadId;
    }

    async resumeThread(threadId: string): Promise<string> {
        const result = await this.request('thread/resume', {
            threadId,
            model: this.model,
            approvalPolicy: 'never',
            sandbox: 'danger-full-access',
            cwd: this.workDir,
            config: this.reasoningConfig(),
            excludeTurns: true,
        }) as { thread: { id: string } };
        this.threadId = result.thread.id;
        return this.threadId;
    }

    async startTurn(prompt: string): Promise<void> {
        if (!this.threadId) throw new Error('No active thread');
        await this.request('turn/start', {
            threadId: this.threadId,
            input: [{
                type: 'text' as const,
                text: prompt,
                text_elements: [],
            }],
            effort: this.effort || undefined,
            summary: 'detailed',
        });
    }

    async interruptTurn(): Promise<void> {
        if (!this.threadId) return;
        await this.request('turn/interrupt', { threadId: this.threadId });
    }

    async listModels(): Promise<unknown[]> {
        const result = await this.request('model/list', {}) as { data: unknown[] };
        return result.data || [];
    }

    async closeGracefully(): Promise<void> {
        try {
            if (this.threadId) {
                await this.request('thread/unsubscribe', { threadId: this.threadId }).catch(() => {});
            }
        } catch { /* best effort */ }
        this.proc?.stdin?.end();
        await new Promise<void>((r) => {
            const t = setTimeout(() => { this.kill(); r(); }, 3000);
            if (this.proc) {
                this.proc.once('exit', () => { clearTimeout(t); r(); });
            } else {
                clearTimeout(t); r();
            }
        });
    }

    kill(): void {
        if (this.proc && !this.proc.killed) {
            this.proc.kill('SIGTERM');
            setTimeout(() => {
                if (this.proc && !this.proc.killed) this.proc.kill('SIGKILL');
            }, 2000);
        }
    }

    cleanup(): void {
        if (this.cleaned) return;
        this.cleaned = true;
        this.rejectAllPending('Client cleanup');
        this.rl?.close();
        this.rl = null;
        this.removeAllListeners();
    }

    // ─── Internal ─────────────────────────────────

    private rejectAllPending(reason: string): void {
        if (this.pending.size === 0) return;
        const err = new Error(reason);
        for (const handler of this.pending.values()) handler.reject(err);
        this.pending.clear();
    }

    private request(method: string, params: Record<string, unknown>): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            this.pending.set(id, { resolve, reject });
            if (!this.trySend({ jsonrpc: '2.0', id, method, params })) {
                this.pending.delete(id);
                reject(new Error('stdin not writable'));
            }
        });
    }

    private notify(method: string, params: Record<string, unknown>): void {
        this.trySend({ jsonrpc: '2.0', method, params });
    }

    private trySend(msg: Record<string, unknown>): boolean {
        const stdin = this.proc?.stdin;
        if (!stdin || stdin.destroyed || stdin.writableEnded || !stdin.writable) return false;
        try {
            stdin.write(JSON.stringify(msg) + '\n');
            return true;
        } catch {
            return false;
        }
    }

    private reasoningConfig(): Record<string, unknown> {
        return {
            ...(this.effort ? { model_reasoning_effort: this.effort } : {}),
            model_reasoning_summary: 'detailed',
            hide_agent_reasoning: false,
            show_raw_agent_reasoning: true,
        };
    }

    private handleLine(line: string): void {
        if (!line.trim()) return;
        try {
            const msg = JSON.parse(line);

            if (msg.id != null && this.pending.has(msg.id)) {
                const handler = this.pending.get(msg.id)!;
                this.pending.delete(msg.id);
                if (msg.error) {
                    handler.reject(new Error(
                        `JSON-RPC error ${msg.error.code}: ${msg.error.message}`
                    ));
                } else {
                    handler.resolve(msg.result);
                }
                return;
            }

            if (msg.id != null && msg.method) {
                this.handleServerRequest(msg.id, msg.method, msg.params || {});
                return;
            }

            if (msg.method) {
                this.emit('notification', msg.method, msg.params || {});
                if (msg.method === 'error') {
                    this.emit('server-error', msg.params || {});
                } else {
                    this.emit(msg.method, msg.params || {});
                }
                return;
            }
        } catch {
            this.emit('parse_error', line);
        }
    }

    private handleServerRequest(id: number | string, method: string, params: Record<string, unknown>): void {
        console.log(`[codex-app] server request: ${method} (id=${id}) — auto-declining`);
        this.emit('server_request', method, params, id);

        const declineResponses: Record<string, unknown> = {
            'item/commandExecution/requestApproval': { decision: 'decline' },
            'item/fileChange/requestApproval': { decision: 'decline' },
            'item/permissions/requestApproval': { decision: 'decline' },
            'mcpServer/elicitation/request': { action: 'decline', content: null },
            'item/tool/requestUserInput': { answers: {} },
            'execCommandApproval': { decision: 'denied' },
            'applyPatchApproval': { decision: 'denied' },
        };

        const result = declineResponses[method] || {};
        this.trySend({ jsonrpc: '2.0', id, result });
    }
}

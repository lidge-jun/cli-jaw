// ─── Codex AppServer Event Normalizer ────────────────
// Maps app-server JSON-RPC notifications to the same
// { tool, text, sessionId, tokens } shape spawn.ts expects.

import type { SpawnContext, ToolEntry } from '../types/agent.js';

type EvRec = Record<string, unknown>;

export interface CodexAppEventResult {
    tool?: ToolEntry | undefined;
    text?: string | undefined;
    sessionId?: string | undefined;
    tokens?: Record<string, number> | undefined;
    flushThinking?: boolean | undefined;
    turnStatus?: string | undefined;
}

function f(obj: EvRec, key: string): unknown { return obj[key]; }
function fs(obj: EvRec, key: string): string { return String(obj[key] ?? ''); }

export function extractFromCodexAppEvent(
    method: string,
    params: EvRec,
    ctx: SpawnContext,
): CodexAppEventResult | null {
    switch (method) {
        case 'turn/started':
            return handleTurnStarted(params, ctx);
        case 'item/started':
            return handleItemStarted(params);
        case 'item/agentMessage/delta':
            return handleAgentMessageDelta(params);
        case 'item/completed':
            return handleItemCompleted(params);
        case 'thread/tokenUsage/updated':
            return handleTokenUsageUpdated(params, ctx);
        case 'item/reasoning/summaryTextDelta':
            return handleReasoningSummaryDelta(params);
        case 'turn/completed': {
            const turn = f(params, 'turn') as EvRec | undefined;
            const status = turn ? fs(turn, 'status') : 'completed';
            return { flushThinking: true, turnStatus: status || 'completed' };
        }
        case 'error':
            return handleError(params);
        default:
            return null;
    }
}

function handleTurnStarted(params: EvRec, ctx: SpawnContext): CodexAppEventResult {
    const threadId = fs(params, 'threadId') || undefined;
    if (threadId) ctx.sessionId = threadId;
    return threadId ? { sessionId: threadId } : {};
}

function handleItemStarted(params: EvRec): CodexAppEventResult | null {
    const item = f(params, 'item') as EvRec | undefined;
    if (!item) return null;

    const type = fs(item, 'type');
    const id = fs(item, 'id');

    switch (type) {
        case 'commandExecution': {
            const command = fs(item, 'command') || 'exec';
            return {
                tool: {
                    icon: '⚡',
                    label: command.length > 120 ? command.slice(0, 119) + '…' : command,
                    toolType: 'command' as const,
                    detail: command,
                    stepRef: `codex-app:item:${id}`,
                    status: 'running',
                },
            };
        }
        case 'fileChange': {
            const changes = f(item, 'changes') as Array<EvRec> | undefined;
            const firstFile = changes?.[0] ? (fs(changes[0], 'path') || fs(changes[0], 'file') || 'file') : 'file';
            const count = changes?.length || 1;
            const label = count > 1 ? `${count} file changes (${firstFile}, ...)` : `edit ${firstFile}`;
            return {
                tool: {
                    icon: '✏️',
                    label,
                    toolType: 'file' as const,
                    detail: String(firstFile),
                    stepRef: `codex-app:item:${id}`,
                    status: 'running',
                },
            };
        }
        case 'webSearch': {
            const query = fs(item, 'query') || 'search';
            return {
                tool: {
                    icon: '🔍',
                    label: `search: ${query.slice(0, 80)}`,
                    toolType: 'search' as const,
                    detail: query,
                    stepRef: `codex-app:item:${id}`,
                    status: 'running',
                },
            };
        }
        case 'mcpToolCall': {
            const server = fs(item, 'server') || 'mcp';
            const tool = fs(item, 'tool') || 'call';
            return {
                tool: {
                    icon: '🔧',
                    label: `${server}/${tool}`,
                    toolType: 'tool' as const,
                    detail: `${server}/${tool}`,
                    stepRef: `codex-app:item:${id}`,
                    status: 'running',
                },
            };
        }
        case 'collabAgentToolCall': {
            const prompt = fs(item, 'prompt');
            return {
                tool: {
                    icon: '🤖',
                    label: `sub-agent: ${prompt.slice(0, 60) || 'collab'}`,
                    toolType: 'tool' as const,
                    detail: prompt,
                    stepRef: `codex-app:item:${id}`,
                    status: 'running',
                },
            };
        }
        case 'reasoning': {
            const summaryArr = f(item, 'summary') as string[] | undefined;
            const label = (summaryArr && summaryArr.length > 0) ? summaryArr[0]!.slice(0, 80) : 'thinking...';
            return {
                tool: {
                    icon: '💭',
                    label,
                    toolType: 'thinking' as const,
                    detail: summaryArr?.join('\n') || '',
                    stepRef: `codex-app:item:${id}`,
                },
            };
        }
        case 'agentMessage':
        case 'userMessage':
        case 'hookPrompt':
            return null;
        default:
            return null;
    }
}

function handleAgentMessageDelta(params: EvRec): CodexAppEventResult | null {
    const delta = f(params, 'delta');
    if (typeof delta === 'string') return { text: delta };
    return null;
}

function handleReasoningSummaryDelta(params: EvRec): CodexAppEventResult | null {
    const delta = f(params, 'delta');
    if (typeof delta !== 'string') return null;
    return {
        tool: {
            icon: '💭',
            label: delta.length > 80 ? delta.slice(0, 79) + '…' : delta,
            toolType: 'thinking' as const,
            detail: delta,
        },
    };
}

function handleItemCompleted(params: EvRec): CodexAppEventResult | null {
    const item = f(params, 'item') as EvRec | undefined;
    if (!item) return null;

    const type = fs(item, 'type');
    const id = fs(item, 'id');

    if (type === 'agentMessage') {
        return null;
    }

    if (type === 'userMessage' || type === 'hookPrompt') {
        return null;
    }
    if (type === 'reasoning') {
        return { flushThinking: true };
    }

    const itemStatus = f(item, 'status');
    const failed = typeof itemStatus === 'string'
        ? itemStatus === 'failed'
        : (itemStatus as EvRec | undefined)?.['type'] === 'failed';
    return {
        tool: {
            icon: failed ? '❌' : '✅',
            label: `${type} ${failed ? 'failed' : 'completed'}`,
            toolType: 'tool' as const,
            stepRef: `codex-app:item:${id}`,
            status: failed ? 'failed' : 'completed',
        },
    };
}

function handleTokenUsageUpdated(params: EvRec, ctx: SpawnContext): CodexAppEventResult {
    const usage = f(params, 'tokenUsage') as EvRec | undefined;
    const last = usage ? f(usage, 'last') as EvRec | undefined : undefined;
    if (last) {
        ctx.tokens = {
            input_tokens: (last['inputTokens'] as number) || 0,
            output_tokens: (last['outputTokens'] as number) || 0,
            ...(last['cachedInputTokens'] ? { cached_input_tokens: last['cachedInputTokens'] as number } : {}),
        };
    }
    return ctx.tokens ? { tokens: ctx.tokens } : {};
}

function handleError(params: EvRec): CodexAppEventResult {
    const error = f(params, 'error') as EvRec | undefined;
    const message = error ? fs(error, 'message') : 'unknown error';
    const willRetry = f(params, 'willRetry') as boolean || false;
    if (willRetry) {
        return {
            tool: {
                icon: '⚠️',
                label: `retrying: ${message.slice(0, 80)}`,
                toolType: 'tool' as const,
                detail: message,
            },
        };
    }
    return { text: `\n❌ Codex error: ${message}` };
}

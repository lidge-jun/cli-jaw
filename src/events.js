// ─── Event Extraction (NDJSON parser) ────────────────

import { broadcast } from './bus.js';

export function extractSessionId(cli, event) {
    switch (cli) {
        case 'claude': return event.type === 'system' ? event.session_id : null;
        case 'codex': return event.type === 'thread.started' ? event.thread_id : null;
        case 'gemini': return event.type === 'init' ? event.session_id : null;
        case 'opencode': return event.sessionID || null;
        default: return null;
    }
}

export function extractFromEvent(cli, event, ctx, agentLabel) {
    const toolLabel = extractToolLabel(cli, event);
    if (toolLabel) {
        ctx.toolLog.push(toolLabel);
        broadcast('agent_tool', { agentId: agentLabel, ...toolLabel });
    }

    switch (cli) {
        case 'claude':
            if (event.type === 'assistant' && event.message?.content) {
                for (const block of event.message.content) {
                    if (block.type === 'text') ctx.fullText += block.text;
                }
            } else if (event.type === 'result') {
                ctx.cost = event.total_cost_usd;
                ctx.turns = event.num_turns;
                ctx.duration = event.duration_ms;
                if (event.session_id) ctx.sessionId = event.session_id;
            }
            break;
        case 'codex':
            if (event.type === 'item.completed') {
                if (event.item?.type === 'agent_message') ctx.fullText += event.item.text || '';
            } else if (event.type === 'turn.completed' && event.usage) {
                ctx.tokens = event.usage;
            }
            break;
        case 'gemini':
            if (event.type === 'message' && event.role === 'assistant') {
                ctx.fullText += event.content || '';
            } else if (event.type === 'result') {
                ctx.duration = event.stats?.duration_ms;
                ctx.turns = event.stats?.tool_calls;
            }
            break;
        case 'opencode':
            if (event.type === 'text' && event.part?.text) {
                ctx.fullText += event.part.text;
            } else if (event.type === 'step_finish' && event.part) {
                ctx.sessionId = event.sessionID;
                if (event.part.tokens) {
                    ctx.tokens = { input_tokens: event.part.tokens.input, output_tokens: event.part.tokens.output };
                }
                if (event.part.cost) ctx.cost = event.part.cost;
            }
            break;
    }
}

export function extractToolLabel(cli, event) {
    const item = event.item || event.part || event;
    const type = item?.type || event.type;

    if (cli === 'codex' && event.type === 'item.completed' && item) {
        if (item.type === 'web_search') {
            const action = item.action?.type || '';
            if (action === 'search') return { icon: '🔍', label: (item.query || item.action?.query || 'search').slice(0, 60) };
            if (action === 'open_page') { try { return { icon: '🌐', label: new URL(item.action.url).hostname }; } catch { return { icon: '🌐', label: 'page' }; } }
            return { icon: '🔍', label: (item.query || 'web').slice(0, 60) };
        }
        if (item.type === 'reasoning') return { icon: '💭', label: (item.text || '').replace(/\*+/g, '').trim().slice(0, 60) };
        if (item.type === 'command_execution') return { icon: '⚡', label: (item.command || 'exec').slice(0, 40) };
    }

    if (cli === 'claude' && event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
            if (block.type === 'tool_use') return { icon: '🔧', label: block.name };
            if (block.type === 'thinking') return { icon: '💭', label: (block.thinking || '').slice(0, 60) };
        }
    }

    if (cli === 'gemini') {
        if (event.type === 'tool_use') return { icon: '🔧', label: `${event.tool_name || 'tool'}${event.parameters?.command ? ': ' + event.parameters.command.slice(0, 40) : ''}` };
        if (event.type === 'tool_result') return { icon: event.status === 'success' ? '✅' : '❌', label: `${event.status || 'done'}` };
    }

    if (cli === 'opencode') {
        if (event.type === 'tool_use' && event.part) return { icon: '🔧', label: event.part.tool || 'tool' };
    }

    return null;
}

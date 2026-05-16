import { broadcast } from '../core/bus.js';

export function isJawRuntimeEvent(raw: unknown): boolean {
    return typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>)['type'] === 'jaw_runtime';
}

export function handleJawRuntimeEvent(event: Record<string, unknown>, agentLabel: string): void {
    const eventName = String(event['event'] || '');
    const runId = String(event['run_id'] || '');
    const seq = Number(event['seq'] || 0);

    switch (eventName) {
        case 'runtime_started':
            broadcast('agent:claude-i:runtime_started', { runId, seq, version: event['helperVersion'] });
            break;
        case 'claude_spawned':
            broadcast('agent:claude-i:spawned', { runId, pid: event['pid'] });
            break;
        case 'session_started':
            broadcast('agent:claude-i:session', { runId, sessionId: event['sessionId'], transcriptPath: event['transcriptPath'] });
            break;
        case 'prompt_injected':
            broadcast('agent:claude-i:prompt_injected', { runId });
            break;
        case 'stop_received':
            broadcast('agent:claude-i:stop', { runId, transcriptPath: event['transcriptPath'] });
            break;
        case 'stop_failure':
            broadcast('agent:claude-i:stop_failure', { runId, error: event['error'] });
            break;
        case 'interrupted':
            broadcast('agent:claude-i:interrupted', { runId, sessionId: event['sessionId'], resumable: event['resumable'] });
            break;
        case 'cleanup_started':
        case 'cleanup_done':
            broadcast('agent:claude-i:cleanup', { runId, event: eventName, escalated: event['escalated'] });
            break;
        case 'error':
            broadcast('agent:claude-i:error', { runId, message: event['message'], exitCode: event['exitCode'] });
            break;
        default:
            break;
    }
}

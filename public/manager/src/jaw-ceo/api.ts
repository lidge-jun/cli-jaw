import type {
    JawCeoApiEnvelope,
    JawCeoCompletion,
    JawCeoConfirmationRecord,
    JawCeoManagerEvent,
    JawCeoMessageData,
    JawCeoPublicState,
    JawCeoResponseMode,
    JawCeoToolResult,
    JawCeoVoiceConnectData,
    JawCeoVoiceSettings,
} from './types';

async function parseJawCeoResponse<T>(response: Response, fallback: string): Promise<T> {
    const text = await response.text();
    let body: JawCeoApiEnvelope<T> | null = null;
    if (text.trim()) {
        try {
            body = JSON.parse(text) as JawCeoApiEnvelope<T>;
        } catch {
            throw new Error(`${fallback}: endpoint returned non-JSON; restart the dashboard server to load the Jaw CEO API`);
        }
    }
    if (!response.ok || !body || body.ok === false) {
        const message = body && body.ok === false
            ? body.error || body.message || fallback
            : fallback;
        throw new Error(message);
    }
    return body.data;
}

async function getJson<T>(path: string, fallback: string): Promise<T> {
    const response = await fetch(path);
    return await parseJawCeoResponse<T>(response, fallback);
}

async function postJson<T>(path: string, body: Record<string, unknown> = {}, fallback = 'Jaw CEO request failed'): Promise<T> {
    const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return await parseJawCeoResponse<T>(response, fallback);
}

async function putJson<T>(path: string, body: Record<string, unknown> = {}, fallback = 'Jaw CEO request failed'): Promise<T> {
    const response = await fetch(path, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return await parseJawCeoResponse<T>(response, fallback);
}

export async function fetchJawCeoState(): Promise<JawCeoPublicState> {
    return await getJson<JawCeoPublicState>('/api/jaw-ceo/state', 'Jaw CEO state fetch failed');
}

export async function fetchJawCeoSettings(): Promise<JawCeoVoiceSettings> {
    return await getJson<JawCeoVoiceSettings>('/api/jaw-ceo/settings', 'Jaw CEO settings fetch failed');
}

export async function updateJawCeoSettings(args: { openaiApiKey?: string; clearOpenAiApiKey?: boolean }): Promise<JawCeoVoiceSettings> {
    return await putJson<JawCeoVoiceSettings>('/api/jaw-ceo/settings', args, 'Jaw CEO settings save failed');
}

export async function sendJawCeoMessage(args: {
    text: string;
    selectedPort: number | null;
    sessionId?: string;
    inputMode?: 'text' | 'voice';
    responseMode?: JawCeoResponseMode;
}): Promise<JawCeoToolResult<JawCeoMessageData>> {
    const body: Record<string, unknown> = {
        text: args.text,
        selectedPort: args.selectedPort,
        inputMode: args.inputMode || 'text',
        responseMode: args.responseMode || 'text',
    };
    if (args.sessionId) body["sessionId"] = args.sessionId;
    return await postJson<JawCeoToolResult<JawCeoMessageData>>('/api/jaw-ceo/message', body, 'Jaw CEO message failed');
}

export async function refreshJawCeoEvents(args: {
    ports?: number[];
    events?: JawCeoManagerEvent[];
    sinceCursor?: string;
}): Promise<{ pending: JawCeoCompletion[]; cursor: string }> {
    const body: Record<string, unknown> = {};
    if (args.ports !== undefined) body["ports"] = args.ports;
    if (args.events !== undefined) body["events"] = args.events;
    if (args.sinceCursor !== undefined) body["sinceCursor"] = args.sinceCursor;
    return await postJson<{ pending: JawCeoCompletion[]; cursor: string }>('/api/jaw-ceo/events/refresh', body, 'Jaw CEO event refresh failed');
}

export async function continueJawCeoCompletion(completionKey: string, mode: 'text' | 'voice' | 'both' | 'silent'): Promise<JawCeoToolResult> {
    return await postJson<JawCeoToolResult>(`/api/jaw-ceo/pending/${encodeURIComponent(completionKey)}/continue`, { mode }, 'Jaw CEO continue failed');
}

export async function summarizeJawCeoCompletion(completionKey: string, format: 'short' | 'detailed' = 'short'): Promise<JawCeoToolResult<{ summary: string; completion: JawCeoCompletion }>> {
    return await postJson<JawCeoToolResult<{ summary: string; completion: JawCeoCompletion }>>(
        `/api/jaw-ceo/pending/${encodeURIComponent(completionKey)}/summarize`,
        { format },
        'Jaw CEO summarize failed',
    );
}

export async function updateJawCeoCompletionStatus(completionKey: string, action: 'ack' | 'dismiss'): Promise<JawCeoToolResult<JawCeoCompletion>> {
    return await postJson<JawCeoToolResult<JawCeoCompletion>>(
        `/api/jaw-ceo/pending/${encodeURIComponent(completionKey)}/${action}`,
        {},
        'Jaw CEO pending update failed',
    );
}

export async function connectJawCeoVoice(args: {
    offerSdp: string;
    selectedPort: number | null;
    sessionId?: string;
    responseMode?: 'voice' | 'both';
}): Promise<JawCeoVoiceConnectData> {
    const body: Record<string, unknown> = {
        offerSdp: args.offerSdp,
        selectedPort: args.selectedPort,
        responseMode: args.responseMode || 'voice',
    };
    if (args.sessionId) body["sessionId"] = args.sessionId;
    return await postJson<JawCeoVoiceConnectData>('/api/jaw-ceo/voice/connect', body, 'Jaw CEO voice connect failed');
}

export async function closeJawCeoVoice(sessionId: string): Promise<JawCeoToolResult> {
    return await postJson<JawCeoToolResult>(`/api/jaw-ceo/voice/${encodeURIComponent(sessionId)}/close`, {}, 'Jaw CEO voice close failed');
}

export async function createJawCeoConfirmation(args: {
    action: string;
    argsHash?: string;
    targetPort?: number;
    sessionId?: string;
    expiresInMs?: number;
}): Promise<JawCeoToolResult<JawCeoConfirmationRecord>> {
    const body: Record<string, unknown> = { action: args.action };
    if (args.argsHash !== undefined) body["argsHash"] = args.argsHash;
    if (args.targetPort !== undefined) body["targetPort"] = args.targetPort;
    if (args.sessionId !== undefined) body["sessionId"] = args.sessionId;
    if (args.expiresInMs !== undefined) body["expiresInMs"] = args.expiresInMs;
    return await postJson<JawCeoToolResult<JawCeoConfirmationRecord>>('/api/jaw-ceo/confirmations', body, 'Jaw CEO confirmation create failed');
}

export async function confirmJawCeoConfirmation(id: string, sessionId?: string): Promise<JawCeoToolResult<JawCeoConfirmationRecord>> {
    const body: Record<string, unknown> = {};
    if (sessionId !== undefined) body["sessionId"] = sessionId;
    return await postJson<JawCeoToolResult<JawCeoConfirmationRecord>>(
        `/api/jaw-ceo/confirmations/${encodeURIComponent(id)}/confirm`,
        body,
        'Jaw CEO confirmation failed',
    );
}

export async function cancelJawCeoConfirmation(id: string, reason?: string): Promise<JawCeoToolResult<JawCeoConfirmationRecord>> {
    const body: Record<string, unknown> = {};
    if (reason !== undefined) body["reason"] = reason;
    return await postJson<JawCeoToolResult<JawCeoConfirmationRecord>>(
        `/api/jaw-ceo/confirmations/${encodeURIComponent(id)}/cancel`,
        body,
        'Jaw CEO confirmation cancel failed',
    );
}

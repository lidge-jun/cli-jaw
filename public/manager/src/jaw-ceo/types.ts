export const JAW_CEO_ID = 'jaw-ceo' as const;

export type JawCeoInputMode = 'text' | 'voice';
export type JawCeoResponseMode = 'text' | 'voice' | 'both' | 'silent';
export type JawCeoStatus =
    | 'ready'
    | 'voice_idle'
    | 'voice_connecting'
    | 'voice_active'
    | 'voice_paused'
    | 'voice_sleeping'
    | 'voice_disabled'
    | 'degraded';
export type JawCeoVoiceStatus = 'idle' | 'connecting' | 'active' | 'silent' | 'paused' | 'sleeping' | 'disabled' | 'error';
export type JawCeoCompletionSource = 'agent_done' | 'orchestrate_done' | 'latest_message_fallback';
export type JawCeoPendingStatus = 'pending' | 'spoken' | 'acknowledged' | 'dismissed';
export type JawCeoWatchReason = 'voice_started_task' | 'ceo_routed_task' | 'manual_watch';
export type JawCeoAuditKind = 'tool' | 'policy' | 'lifecycle' | 'completion' | 'docs_edit';
export type JawCeoTranscriptRole = 'user' | 'ceo' | 'tool';

export type JawCeoLatestMessageFallback = {
    mode: 'enabled' | 'disabled' | 'requires_post_watch_proof';
    sinceMessageId?: number;
    postWatchFingerprint?: string;
};

export type JawCeoSessionContext = {
    sessionId: string;
    inputMode: JawCeoInputMode;
    responseMode: JawCeoResponseMode;
    selectedPort: number | null;
    openedAt: string;
    lastUserActivityAt: string;
    voiceArmed: boolean;
    frontendPresence: 'active' | 'visible' | 'hidden' | 'gone';
    autoRead: boolean;
};

export type JawCeoWatch = {
    watchId: string;
    dispatchRef: string;
    port: number;
    reason: JawCeoWatchReason;
    latestMessageFallback: JawCeoLatestMessageFallback;
    sessionId?: string;
    autoRead: boolean;
    createdAt: string;
    lastUserActivityAt: string;
};

export type JawCeoCompletion = {
    completionKey: string;
    source: JawCeoCompletionSource;
    port: number;
    dispatchRef: string;
    watchId: string;
    messageId?: number;
    requestId?: string;
    sessionId?: string;
    detectedAt: string;
    summary?: string;
    resultText?: string;
    workerResultRef: {
        port: number;
        messageId?: number;
        traceRunId?: string;
    };
    status: JawCeoPendingStatus;
    aliases?: string[];
};

export type JawCeoConfirmationRecord = {
    id: string;
    action: string;
    argsHash: string;
    targetPort?: number;
    sessionId: string;
    createdAt: string;
    expiresAt: string;
    consumedAt?: string;
    cancelledAt?: string;
};

export type JawCeoAuditRecord = {
    id: string;
    at: string;
    kind: JawCeoAuditKind;
    action: string;
    ok: boolean;
    port?: number;
    message: string;
    meta?: Record<string, unknown>;
};

export type JawCeoTranscriptEntry = {
    id: string;
    at: string;
    role: JawCeoTranscriptRole;
    text: string;
    source: 'text' | 'voice' | 'completion' | 'system';
};

export type JawCeoVoiceRuntimeState = {
    status: JawCeoVoiceStatus;
    sessionId: string | null;
    model: string;
    voice: string;
    error: string | null;
};

export type JawCeoPublicState = {
    session: JawCeoSessionContext;
    transcript: JawCeoTranscriptEntry[];
    watches: JawCeoWatch[];
    pending: JawCeoCompletion[];
    auditTail: JawCeoAuditRecord[];
    voice: JawCeoVoiceRuntimeState;
};

export type JawCeoManagerEvent =
    | { kind: 'instance-message'; port: number; messageId: number; role: string; at: string; postWatchFingerprint?: string; text?: string }
    | { kind: 'instance-completed'; port: number; source: 'agent_done' | 'orchestrate_done'; requestId?: string; messageId?: number; at: string; text?: string };

export type JawCeoToolResult<T = unknown> = {
    ok: boolean;
    tool: string;
    message?: string;
    data?: T;
    error?: {
        code: string;
        message: string;
        suggestedNextAction?: string;
    };
    auditId: string;
    sourceLabels: string[];
    untrustedText?: string;
};

export type JawCeoApiEnvelope<T> =
    | { ok: true; data: T }
    | { ok: false; code?: string; error?: string; message?: string };

export type JawCeoMessageData = {
    response: string;
    pending: JawCeoCompletion[];
};

export type JawCeoVoiceConnectData = {
    sessionId: string;
    answerSdp: string;
    model: string;
    voice: string;
};

export type JawCeoVoiceSettings = {
    openaiKeySet: boolean;
    openaiKeyLast4: string;
    openaiKeySource: 'deps' | 'env' | 'settings' | 'none';
    openaiKeyInvalid?: boolean;
    model: string;
    voice: string;
};

export type JawCeoConsoleTab = 'chat' | 'settings';

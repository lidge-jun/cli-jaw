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

export type JawCeoCompletionSource =
    | 'agent_done'
    | 'orchestrate_done'
    | 'latest_message_fallback';

export type JawCeoPendingStatus =
    | 'pending'
    | 'spoken'
    | 'acknowledged'
    | 'dismissed';

export type JawCeoWatchReason =
    | 'voice_started_task'
    | 'ceo_routed_task'
    | 'manual_watch';

export type JawCeoAuditKind = 'tool' | 'policy' | 'lifecycle' | 'completion' | 'docs_edit';

export interface JawCeoLatestMessageFallback {
    mode: 'enabled' | 'disabled' | 'requires_post_watch_proof';
    sinceMessageId?: number | undefined;
    postWatchFingerprint?: string | undefined;
}

export interface JawCeoSessionContext {
    sessionId: string;
    inputMode: JawCeoInputMode;
    responseMode: JawCeoResponseMode;
    selectedPort: number | null;
    openedAt: string;
    lastUserActivityAt: string;
    voiceArmed: boolean;
    frontendPresence: 'active' | 'visible' | 'hidden' | 'gone';
    autoRead: boolean;
}

export interface JawCeoWatch {
    watchId: string;
    dispatchRef: string;
    port: number;
    reason: JawCeoWatchReason;
    latestMessageFallback: JawCeoLatestMessageFallback;
    sessionId?: string | undefined;
    autoRead: boolean;
    createdAt: string;
    lastUserActivityAt: string;
}

export interface JawCeoCompletion {
    completionKey: string;
    source: JawCeoCompletionSource;
    port: number;
    dispatchRef: string;
    watchId: string;
    messageId?: number | undefined;
    requestId?: string | undefined;
    sessionId?: string | undefined;
    detectedAt: string;
    summary?: string | undefined;
    resultText?: string | undefined;
    workerResultRef: {
        port: number;
        messageId?: number | undefined;
        traceRunId?: string | undefined;
    };
    status: JawCeoPendingStatus;
    aliases?: string[] | undefined;
}

export interface JawCeoConfirmationRecord {
    id: string;
    action: string;
    argsHash: string;
    targetPort?: number | undefined;
    sessionId: string;
    createdAt: string;
    expiresAt: string;
    consumedAt?: string | undefined;
    cancelledAt?: string | undefined;
}

export interface JawCeoAuditRecord {
    id: string;
    at: string;
    kind: JawCeoAuditKind;
    action: string;
    ok: boolean;
    port?: number | undefined;
    message: string;
    meta?: Record<string, unknown> | undefined;
}

export interface JawCeoVoiceRuntimeState {
    status: JawCeoVoiceStatus;
    sessionId: string | null;
    model: string;
    voice: string;
    error: string | null;
}

export interface JawCeoPublicState {
    session: JawCeoSessionContext;
    watches: JawCeoWatch[];
    pending: JawCeoCompletion[];
    auditTail: JawCeoAuditRecord[];
    voice: JawCeoVoiceRuntimeState;
}

export interface JawCeoInstanceSummary {
    port: number;
    label: string;
    status: string;
    ok: boolean;
    url?: string | undefined;
    currentCli?: string | null | undefined;
    currentModel?: string | null | undefined;
    workingDir?: string | null | undefined;
}

export interface JawCeoLatestMessageSnapshot {
    latestAssistant: {
        id: number;
        role: 'assistant';
        created_at?: string | undefined;
        text?: string | undefined;
    } | null;
    activity?: {
        messageId: number;
        role: string;
        title?: string | undefined;
        updatedAt?: string | undefined;
    } | null;
}

export type JawCeoManagerEvent =
    | { kind: 'instance-message'; port: number; messageId: number; role: string; at: string; postWatchFingerprint?: string | undefined; text?: string | undefined }
    | { kind: 'instance-completed'; port: number; source: 'agent_done' | 'orchestrate_done'; requestId?: string | undefined; messageId?: number | undefined; at: string; text?: string | undefined };

export type JawCeoToolResult<T = unknown> = {
    ok: boolean;
    tool: string;
    data?: T | undefined;
    error?: {
        code: string;
        message: string;
        suggestedNextAction?: string | undefined;
    };
    auditId: string;
    sourceLabels: string[];
    untrustedText?: string | undefined;
};

export type JawCeoStateResponse = JawCeoPublicState;

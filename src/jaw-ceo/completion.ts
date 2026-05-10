import type {
    JawCeoCompletion,
    JawCeoCompletionSource,
    JawCeoManagerEvent,
    JawCeoWatch,
} from './types.js';

const RESULT_PREVIEW_MAX_CHARS = 320;

function normalizeResultText(text?: string): string | undefined {
    const normalized = String(text || '').replace(/\r/g, '').trim();
    return normalized ? normalized : undefined;
}

export function previewWorkerResultText(text?: string): string | undefined {
    const normalized = normalizeResultText(text);
    if (!normalized) return undefined;
    const compact = normalized
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .join('\n');
    if (compact.length <= RESULT_PREVIEW_MAX_CHARS) return compact;
    return `${compact.slice(0, RESULT_PREVIEW_MAX_CHARS - 3).trimEnd()}...`;
}

export function completionKey(input: {
    source: JawCeoCompletionSource;
    port: number;
    dispatchRef: string;
    watchId: string;
    messageId?: number;
    requestId?: string;
}): string {
    const terminalId = input.requestId ?? input.messageId;
    if (terminalId === undefined || terminalId === null) {
        return `${input.dispatchRef}:${input.watchId}:${input.port}:${input.source}`;
    }
    return `${input.dispatchRef}:${input.watchId}:${input.port}:${terminalId}`;
}

export function completionFromInstanceMessage(input: {
    port: number;
    messageId: number;
    at: string;
    watch: JawCeoWatch;
    text?: string | undefined;
}): JawCeoCompletion {
    const resultText = normalizeResultText(input.text);
    return {
        completionKey: completionKey({
            source: 'latest_message_fallback',
            port: input.port,
            dispatchRef: input.watch.dispatchRef,
            watchId: input.watch.watchId,
            messageId: input.messageId,
        }),
        source: 'latest_message_fallback',
        port: input.port,
        dispatchRef: input.watch.dispatchRef,
        watchId: input.watch.watchId,
        messageId: input.messageId,
        ...(input.watch.sessionId ? { sessionId: input.watch.sessionId } : {}),
        detectedAt: input.at,
        summary: previewWorkerResultText(resultText) || `Worker :${input.port} produced a new assistant result.`,
        ...(resultText ? { resultText } : {}),
        workerResultRef: {
            port: input.port,
            messageId: input.messageId,
        },
        status: 'pending',
    };
}

export function completionFromDoneEvent(input: {
    event: Extract<JawCeoManagerEvent, { kind: 'instance-completed' }>;
    watch: JawCeoWatch;
}): JawCeoCompletion {
    const resultText = normalizeResultText(input.event.text);
    return {
        completionKey: completionKey({
            source: input.event.source,
            port: input.event.port,
            dispatchRef: input.watch.dispatchRef,
            watchId: input.watch.watchId,
            ...(input.event.messageId !== undefined ? { messageId: input.event.messageId } : {}),
            ...(input.event.requestId !== undefined ? { requestId: input.event.requestId } : {}),
        }),
        source: input.event.source,
        port: input.event.port,
        dispatchRef: input.watch.dispatchRef,
        watchId: input.watch.watchId,
        ...(input.event.messageId !== undefined ? { messageId: input.event.messageId } : {}),
        ...(input.event.requestId !== undefined ? { requestId: input.event.requestId } : {}),
        ...(input.watch.sessionId ? { sessionId: input.watch.sessionId } : {}),
        detectedAt: input.event.at,
        summary: previewWorkerResultText(resultText) || `Worker :${input.event.port} completed a watched task.`,
        ...(resultText ? { resultText } : {}),
        workerResultRef: {
            port: input.event.port,
            ...(input.event.messageId !== undefined ? { messageId: input.event.messageId } : {}),
        },
        status: 'pending',
    };
}

export function canCreateFallbackCompletion(args: {
    watch: JawCeoWatch;
    messageId: number;
    postWatchFingerprint?: string;
}): { ok: true } | { ok: false; code: string; message: string } {
    const fallback = args.watch.latestMessageFallback;
    if (fallback.mode === 'disabled') {
        return { ok: false, code: 'fallback_disabled', message: 'latest-message fallback is disabled for this watch' };
    }
    if (fallback.mode === 'enabled') {
        if (fallback.sinceMessageId === undefined) {
            return { ok: false, code: 'fallback_missing_baseline', message: 'fallback baseline is missing' };
        }
        if (args.messageId <= fallback.sinceMessageId) {
            return { ok: false, code: 'fallback_stale_message', message: 'latest assistant message is not newer than the watch baseline' };
        }
    }
    if (fallback.mode === 'requires_post_watch_proof') {
        const proof = args.postWatchFingerprint || fallback.postWatchFingerprint;
        if (!proof) {
            return { ok: false, code: 'fallback_missing_post_watch_proof', message: 'post-watch proof is required for fallback completion' };
        }
    }
    return { ok: true };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { closeJawCeoVoice, continueJawCeoCompletion, sendJawCeoMessage } from './api';
import type { JawCeoCompletion, JawCeoResponseMode, JawCeoVoiceStatus } from './types';
import { playJawCeoVoiceCue } from './voice-cues';
import { createJawCeoVoicePeerSession, type JawCeoVoicePeerSession } from './voice-session';

const SILENT_STATE_AFTER_MS = 4_000;
const SILENT_CUE_MIN_INTERVAL_MS = 30_000;

export type UseJawCeoVoiceArgs = {
    selectedPort: number | null;
    sessionId?: string;
    autoRead: boolean;
    documentVisible: boolean;
    onTranscript: (text: string) => void;
    onSpokenCompletion: (completionKey: string) => void;
};

export type JawCeoVoiceController = {
    status: JawCeoVoiceStatus;
    error: string | null;
    lastEventType: string | null;
    lastTranscript: string | null;
    talk: () => Promise<void>;
    stop: () => Promise<void>;
    end: () => Promise<void>;
    sendText: (text: string, responseMode: JawCeoResponseMode) => Promise<void>;
    speakCompletion: (completion: JawCeoCompletion) => Promise<void>;
};

function transcriptFromRealtimeEvent(event: unknown): string | null {
    if (!event || typeof event !== 'object') return null;
    const record = event as Record<string, unknown>;
    const type = String(record["type"] || '');
    if (typeof record["delta"] === 'string' && (
        type === 'response.audio_transcript.delta'
        || type === 'response.text.delta'
        || type === 'response.output_text.delta'
    )) return record["delta"];
    if (typeof record["transcript"] === 'string') return record["transcript"];
    if (typeof record["text"] === 'string' && (type.includes('transcript') || type.includes('text'))) return record["text"];
    if (typeof record["output"] === 'string') return record["output"];
    return null;
}

function shouldAppendRealtimeText(eventType: string | null): boolean {
    return eventType === 'response.audio_transcript.delta'
        || eventType === 'response.text.delta'
        || eventType === 'response.output_text.delta';
}

function eventTypeFromRealtimeEvent(event: unknown): string | null {
    if (!event || typeof event !== 'object') return null;
    const type = (event as Record<string, unknown>)["type"];
    return typeof type === 'string' ? type : null;
}

export function useJawCeoVoice(args: UseJawCeoVoiceArgs): JawCeoVoiceController {
    const [status, setStatus] = useState<JawCeoVoiceStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const [lastEventType, setLastEventType] = useState<string | null>(null);
    const [lastTranscript, setLastTranscript] = useState<string | null>(null);
    const sessionRef = useRef<JawCeoVoicePeerSession | null>(null);
    const argsRef = useRef(args);
    const connectTokenRef = useRef(0);
    const lastActivityAtRef = useRef(Date.now());
    const lastSilentCueAtRef = useRef(0);
    const responseTranscriptRef = useRef('');

    useEffect(() => {
        argsRef.current = args;
    }, [args]);

    function markActivity(eventType: string | null, transcript?: string | null): void {
        lastActivityAtRef.current = Date.now();
        if (eventType) setLastEventType(eventType);
        if (transcript) setLastTranscript(transcript.length > 180 ? `${transcript.slice(0, 177)}...` : transcript);
        setStatus(current => current === 'silent' ? 'active' : current);
    }

    const closePhysicalSession = useCallback(async () => {
        connectTokenRef.current += 1;
        const current = sessionRef.current;
        sessionRef.current = null;
        if (current) {
            current.close();
            await closeJawCeoVoice(current.sessionId).catch(() => undefined);
        }
        setStatus('sleeping');
    }, []);

    const stop = useCallback(async () => {
        if (status === 'connecting' && !sessionRef.current) {
            connectTokenRef.current += 1;
            playJawCeoVoiceCue('stop');
            setStatus('paused');
            return;
        }
        sessionRef.current?.setMicEnabled(false);
        playJawCeoVoiceCue('stop');
        setStatus('paused');
    }, [status]);

    const end = useCallback(async () => {
        await closePhysicalSession();
        playJawCeoVoiceCue('stop');
    }, [closePhysicalSession]);

    const talk = useCallback(async () => {
        if (sessionRef.current) {
            sessionRef.current.setMicEnabled(true);
            lastActivityAtRef.current = Date.now();
            setError(null);
            playJawCeoVoiceCue('start');
            setStatus('active');
            return;
        }
        if (status === 'connecting') return;
        const token = connectTokenRef.current + 1;
        connectTokenRef.current = token;
        setStatus('connecting');
        setError(null);
        setLastEventType(null);
        setLastTranscript(null);
        responseTranscriptRef.current = '';
        playJawCeoVoiceCue('start');
        try {
            const session = await createJawCeoVoicePeerSession({
                selectedPort: argsRef.current.selectedPort,
                ...(argsRef.current.sessionId ? { sessionId: argsRef.current.sessionId } : {}),
                onRealtimeEvent: event => {
                    const eventType = eventTypeFromRealtimeEvent(event);
                    const rawTranscript = transcriptFromRealtimeEvent(event);
                    const transcript = rawTranscript && shouldAppendRealtimeText(eventType)
                        ? `${responseTranscriptRef.current}${rawTranscript}`
                        : rawTranscript;
                    if (rawTranscript && shouldAppendRealtimeText(eventType)) responseTranscriptRef.current = transcript || '';
                    if (eventType === 'response.created') responseTranscriptRef.current = '';
                    markActivity(eventType, transcript);
                    if (transcript) argsRef.current.onTranscript(transcript);
                },
            });
            if (connectTokenRef.current !== token) {
                session.close();
                await closeJawCeoVoice(session.sessionId).catch(() => undefined);
                return;
            }
            sessionRef.current = session;
            lastActivityAtRef.current = Date.now();
            setStatus('active');
        } catch (err) {
            if (connectTokenRef.current !== token) return;
            setError((err as Error).message);
            playJawCeoVoiceCue('error');
            setStatus((err as Error).message.includes('OPENAI_API_KEY') ? 'disabled' : 'error');
            sessionRef.current?.close();
            sessionRef.current = null;
        }
    }, [status]);

    const sendText = useCallback(async (text: string, responseMode: JawCeoResponseMode) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        await sendJawCeoMessage({
            text: trimmed,
            selectedPort: argsRef.current.selectedPort,
            ...(argsRef.current.sessionId ? { sessionId: argsRef.current.sessionId } : {}),
            inputMode: 'voice',
            responseMode,
        });
    }, []);

    const speakCompletion = useCallback(async (completion: JawCeoCompletion) => {
        await continueJawCeoCompletion(completion.completionKey, 'voice');
        argsRef.current.onSpokenCompletion(completion.completionKey);
    }, []);

    useEffect(() => {
        return () => {
            connectTokenRef.current += 1;
            const current = sessionRef.current;
            sessionRef.current = null;
            if (current) {
                current.close();
                void closeJawCeoVoice(current.sessionId).catch(() => undefined);
            }
        };
    }, []);

    useEffect(() => {
        if (args.documentVisible) return;
        const current = sessionRef.current;
        if (!current) return;
        connectTokenRef.current += 1;
        sessionRef.current = null;
        current.close();
        void closeJawCeoVoice(current.sessionId).catch(() => undefined);
        setStatus('sleeping');
    }, [args.documentVisible]);

    useEffect(() => {
        if (status !== 'active' && status !== 'silent') return undefined;
        const timer = window.setInterval(() => {
            if (!sessionRef.current) return;
            const now = Date.now();
            if (now - lastActivityAtRef.current < SILENT_STATE_AFTER_MS) return;
            setStatus('silent');
            if (now - lastSilentCueAtRef.current >= SILENT_CUE_MIN_INTERVAL_MS) {
                playJawCeoVoiceCue('silent');
                lastSilentCueAtRef.current = now;
            }
        }, 1_000);
        return () => window.clearInterval(timer);
    }, [status]);

    void args.autoRead;

    return { status, error, lastEventType, lastTranscript, talk, stop, end, sendText, speakCompletion };
}

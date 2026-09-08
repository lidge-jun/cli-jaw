import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Composer dictation over the existing `/api/voice` endpoint.
 *
 * The route already transcribes an uploaded blob; `x-stt-only` makes it return
 * the text instead of submitting it as a chat message, which is what a composer
 * needs. Nothing here is speculative: if the browser cannot record, the control
 * reports why and stays disabled rather than pretending to listen.
 */
export type DictationStatus = 'unsupported' | 'idle' | 'recording' | 'transcribing';

export interface Dictation {
    status: DictationStatus;
    /** Why the control is disabled, or what pressing it will do. */
    reason: string;
    error: string | null;
    toggle(): void;
}

function pickMime(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    for (const candidate of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']) {
        if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    }
    return '';
}

function extensionFor(mime: string): string {
    if (mime.includes('mp4')) return '.mp4';
    if (mime.includes('ogg')) return '.ogg';
    return '.webm';
}

function describe(error: unknown): string {
    const name = (error as DOMException | undefined)?.name;
    if (name === 'NotAllowedError') return 'Microphone access was denied.';
    if (name === 'NotFoundError') return 'No microphone was found.';
    if (name === 'NotReadableError' || name === 'AbortError') return 'The microphone is in use by another application.';
    return error instanceof Error ? error.message : 'Dictation failed.';
}

export function useDictation(onText: (text: string) => void, disabled: boolean): Dictation {
    const [status, setStatus] = useState<DictationStatus>('unsupported');
    const [error, setError] = useState<string | null>(null);
    const recorder = useRef<MediaRecorder | null>(null);
    const stream = useRef<MediaStream | null>(null);
    const chunks = useRef<Blob[]>([]);
    const live = useRef(true);

    useEffect(() => {
        // Capability is checked, never assumed: a plain-HTTP origin other than
        // localhost has no mediaDevices at all.
        const supported = typeof MediaRecorder !== 'undefined'
            && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
        setStatus(supported ? 'idle' : 'unsupported');
        return () => {
            live.current = false;
            recorder.current?.state === 'recording' && recorder.current.stop();
            stream.current?.getTracks().forEach(track => track.stop());
        };
    }, []);

    const transcribe = useCallback(async (blob: Blob, mime: string) => {
        setStatus('transcribing');
        try {
            const response = await fetch('/api/voice', {
                method: 'POST',
                headers: { 'Content-Type': mime || 'audio/webm', 'X-Voice-Ext': extensionFor(mime), 'X-Stt-Only': 'true' },
                body: blob,
            });
            const payload = await response.json().catch(() => null) as { text?: string; error?: string } | null;
            if (!response.ok) throw new Error(payload?.error || `Transcription failed (${response.status}).`);
            const text = payload?.text?.trim();
            if (!live.current) return;
            if (text) onText(text);
            else setError('Nothing was transcribed.');
        } catch (err) {
            if (live.current) setError(describe(err));
        } finally {
            if (live.current) setStatus('idle');
        }
    }, [onText]);

    const toggle = useCallback(() => {
        if (status === 'unsupported' || status === 'transcribing' || disabled) return;
        if (status === 'recording') {
            recorder.current?.stop();
            return;
        }
        setError(null);
        void (async () => {
            let captured: MediaStream;
            try { captured = await navigator.mediaDevices.getUserMedia({ audio: true }); }
            catch (err) { setError(describe(err)); return; }
            if (!live.current) { captured.getTracks().forEach(track => track.stop()); return; }
            stream.current = captured;
            const mime = pickMime();
            let active: MediaRecorder;
            try { active = new MediaRecorder(captured, mime ? { mimeType: mime } : {}); }
            catch (err) {
                captured.getTracks().forEach(track => track.stop());
                setError(describe(err));
                return;
            }
            recorder.current = active;
            chunks.current = [];
            active.ondataavailable = event => { if (event.data.size > 0) chunks.current.push(event.data); };
            active.onerror = () => { setError('Recording failed.'); };
            active.onstop = () => {
                captured.getTracks().forEach(track => track.stop());
                stream.current = null;
                recorder.current = null;
                const blob = new Blob(chunks.current, { type: mime || 'audio/webm' });
                chunks.current = [];
                if (!live.current) return;
                if (blob.size === 0) { setStatus('idle'); setError('Nothing was recorded.'); return; }
                void transcribe(blob, mime);
            };
            active.start();
            setStatus('recording');
        })();
    }, [disabled, status, transcribe]);

    const reason = status === 'unsupported'
        ? 'Dictation needs microphone access, which this browser context does not provide.'
        : status === 'recording' ? 'Stop dictation'
            : status === 'transcribing' ? 'Transcribing…' : 'Dictation';
    return { status, reason, error, toggle };
}

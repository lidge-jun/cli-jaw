import { useEffect } from 'react';
import type { JawCeoVoiceController } from './jaw-ceo/useJawCeoVoice';

function isLocalPreviewMessageOrigin(origin: string): boolean {
    if (origin === window.location.origin) return true;
    try {
        const hostname = new URL(origin).hostname;
        return hostname === 'localhost'
            || hostname === '127.0.0.1'
            || hostname === '::1'
            || hostname === '[::1]';
    } catch {
        return false;
    }
}

export function usePreviewSttLifecycle(voice: Pick<JawCeoVoiceController, 'status' | 'end'>): void {
    useEffect(() => {
        function onPreviewSttLifecycle(event: MessageEvent): void {
            const data = event.data as { type?: unknown; action?: unknown } | null;
            if (data?.type !== 'jaw-preview-stt-recording') return;
            if (data.action !== 'request') return;
            if (!isLocalPreviewMessageOrigin(event.origin)) return;
            if (voice.status === 'active' || voice.status === 'silent' || voice.status === 'paused' || voice.status === 'connecting') {
                void voice.end();
            }
        }
        window.addEventListener('message', onPreviewSttLifecycle);
        return () => window.removeEventListener('message', onPreviewSttLifecycle);
    }, [voice.status, voice.end]);
}

// ── Voice Recorder Feature ──
// Cross-platform: Chrome/Firefox/Edge (webm/opus), Safari (mp4/aac)
import { state } from '../state.js';
import { addSystemMsg } from '../ui.js';
import { t } from './i18n.js';
import { ICONS } from '../icons.js';
import { sendVoiceToServer } from './chat.js';

let cancelled = false;

let mediaRecorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let recordingStream: MediaStream | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let startTime = 0;
let startPending = false;
let stopAction: 'stopped' | 'cancelled' | 'failed' = 'stopped';
const MIC_PERMISSION_TIMEOUT_MS = 15000;

type DocumentPermissionPolicy = {
    allowsFeature?: (feature: string) => boolean;
};

type MicPermissionParams = {
    origin: string;
    alternateOrigin: string;
};

/** Pick best supported MIME type for cross-platform */
function pickMime(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
        'audio/webm;codecs=opus',   // Chrome, Firefox, Edge
        'audio/mp4',                 // Safari (macOS/iOS)
        'audio/ogg;codecs=opus',     // Firefox fallback
    ];
    for (const m of candidates) {
        if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return ''; // browser default
}

/** Classify getUserMedia errors into user-friendly messages */
function classifyMicError(err: unknown): string {
    const e = err as DOMException;
    switch (e.name) {
        case 'NotAllowedError':
            return t('voice.micDenied');
        case 'NotFoundError':
            return t('voice.micNotFound');
        case 'NotReadableError':
        case 'AbortError':
            return t('voice.micBusy');
        case 'TimeoutError':
            return micRequestTimeoutMessage();
        default:
            if (e instanceof TypeError || !navigator.mediaDevices) {
                return t('voice.httpsRequired');
            }
            return t('voice.micDenied');
    }
}

function getDocumentPermissionPolicy(): DocumentPermissionPolicy | null {
    const scoped = document as Document & {
        featurePolicy?: DocumentPermissionPolicy;
        permissionsPolicy?: DocumentPermissionPolicy;
    };
    return scoped.permissionsPolicy || scoped.featurePolicy || null;
}

function isMicBlockedByDocumentPolicy(): boolean {
    try {
        return getDocumentPermissionPolicy()?.allowsFeature?.('microphone') === false;
    } catch {
        return false;
    }
}

async function getMicrophonePermissionState(): Promise<PermissionState | null> {
    try {
        if (!navigator.permissions?.query) return null;
        const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        return status.state;
    } catch {
        return null;
    }
}

function micPermissionParams(): MicPermissionParams {
    const current = new URL(window.location.href);
    const alternate = new URL(current.href);
    if (current.hostname === '127.0.0.1') {
        alternate.hostname = 'localhost';
    } else if (current.hostname === 'localhost') {
        alternate.hostname = '127.0.0.1';
    }
    const alternateOrigin = alternate.origin === current.origin ? '' : alternate.origin;
    return { origin: current.origin, alternateOrigin };
}

function micRequestTimeoutMessage(): string {
    const params = micPermissionParams();
    if (params.alternateOrigin) {
        return t('voice.requestTimeoutLoopback', params);
    }
    return t('voice.requestTimeout', params);
}

function classifyRecorderStartError(err: unknown): string {
    const e = err as DOMException;
    if (e.name === 'NotSupportedError') return t('voice.unsupported');
    if (e.name === 'NotReadableError' || e.name === 'AbortError') return t('voice.micBusy');
    if (e instanceof TypeError) return t('voice.httpsRequired');
    return t('voice.interrupted');
}

function postPreviewSttRecording(action: 'request' | 'started' | 'stopped' | 'cancelled' | 'failed'): void {
    if (window.parent === window) return;
    try {
        window.parent.postMessage({ type: 'jaw-preview-stt-recording', action }, '*');
    } catch {
        // Preview coordination is best-effort; standalone STT must keep working.
    }
}

function micPermissionTimeoutError(): DOMException {
    return new DOMException('Timed out waiting for microphone permission prompt', 'TimeoutError');
}

async function requestMicStreamWithTimeout(): Promise<MediaStream> {
    let didTimeout = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const mediaPromise = navigator.mediaDevices.getUserMedia({ audio: true }).then(
        (candidate) => {
            if (didTimeout) {
                candidate.getTracks().forEach(track => track.stop());
                return null;
            }
            return candidate;
        },
        (err: unknown) => {
            if (didTimeout) return null;
            throw err;
        },
    );
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            didTimeout = true;
            reject(micPermissionTimeoutError());
        }, MIC_PERMISSION_TIMEOUT_MS);
    });
    try {
        const stream = await Promise.race([mediaPromise, timeoutPromise]);
        if (!stream) throw micPermissionTimeoutError();
        return stream;
    } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
    }
}

export async function startRecording(): Promise<void> {
    if (state.isRecording || startPending) return;

    // Feature detection
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        addSystemMsg(t('voice.unsupported'), '', 'error');
        return;
    }
    if (isMicBlockedByDocumentPolicy()) {
        addSystemMsg(t('voice.policyBlocked'), '', 'error');
        return;
    }
    if (await getMicrophonePermissionState() === 'denied') {
        addSystemMsg(t('voice.permissionDeniedBrowser', micPermissionParams()), '', 'error');
        return;
    }

    startPending = true;
    cancelled = false;
    stopAction = 'stopped';
    updateRecordingUI(false);
    postPreviewSttRecording('request');

    let stream: MediaStream | null = null;
    try {
        stream = await requestMicStreamWithTimeout();
        recordingStream = stream;
    } catch (err) {
        startPending = false;
        updateRecordingUI(false);
        postPreviewSttRecording('failed');
        addSystemMsg(classifyMicError(err), '', 'error');
        return;
    }

    try {
        const mimeType = pickMime();
        const options: MediaRecorderOptions = mimeType ? { mimeType } : {};
        const recorder = new MediaRecorder(stream, options);
        mediaRecorder = recorder;
        chunks = [];

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onerror = () => {
            cancelled = true;
            stopAction = 'failed';
            state.isRecording = false;
            stopTimer();
            updateRecordingUI(false);
            if (recorder.state === 'recording') {
                recorder.stop();
            } else {
                chunks = [];
                releaseStream();
                mediaRecorder = null;
                postPreviewSttRecording('failed');
            }
            addSystemMsg(t('voice.interrupted'), '', 'error');
        };

        recorder.onstop = async () => {
            const finalAction = stopAction;
            const wasCancelled = cancelled || finalAction !== 'stopped';
            stopAction = 'stopped';
            if (wasCancelled) {
                chunks = [];
                releaseStream();
                mediaRecorder = null;
                cancelled = false;
                postPreviewSttRecording(finalAction);
                return;
            }
            const actualMime = recorder.mimeType || mimeType || 'audio/webm';
            const ext = actualMime.includes('mp4') ? '.m4a'
                      : actualMime.includes('ogg') ? '.ogg'
                      : '.webm';
            const blob = new Blob(chunks, { type: actualMime });
            chunks = [];
            releaseStream();
            mediaRecorder = null;
            cancelled = false;
            postPreviewSttRecording('stopped');

            if (blob.size > 20 * 1024 * 1024) {
                addSystemMsg(t('voice.tooLarge'), '', 'error');
                return;
            }
            if (blob.size < 1000) {
                addSystemMsg(t('voice.tooShort'), '', 'error');
                return;
            }

            await sendVoiceToServer(blob, ext, actualMime);
        };

        // iOS Safari: no timeslice support -> call start() without args
        recorder.start();
        state.isRecording = true;
        startPending = false;
        startTime = Date.now();
        updateRecordingUI(true);
        startTimer();
        postPreviewSttRecording('started');
    } catch (err) {
        startPending = false;
        state.isRecording = false;
        chunks = [];
        mediaRecorder = null;
        releaseStream();
        updateRecordingUI(false);
        postPreviewSttRecording('failed');
        addSystemMsg(classifyRecorderStartError(err), '', 'error');
    }
}

export function stopRecording(): void {
    if (!state.isRecording || !mediaRecorder) return;
    stopAction = 'stopped';
    if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    } else {
        releaseStream();
        mediaRecorder = null;
        postPreviewSttRecording('stopped');
    }
    state.isRecording = false;
    stopTimer();
    updateRecordingUI(false);
}

export function cancelRecording(): void {
    if (!state.isRecording || !mediaRecorder) return;
    cancelled = true;
    stopAction = 'cancelled';
    if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    } else {
        chunks = [];
        releaseStream();
        mediaRecorder = null;
        postPreviewSttRecording('cancelled');
    }
    state.isRecording = false;
    stopTimer();
    updateRecordingUI(false);
}

export function toggleRecording(): void {
    if (state.isRecording) stopRecording();
    else void startRecording();
}

function releaseStream(): void {
    recordingStream?.getTracks().forEach(track => track.stop());
    recordingStream = null;
}

function startTimer(): void {
    const el = document.getElementById('voiceTimer');
    if (!el) return;
    el.style.display = 'inline';
    timerInterval = setInterval(() => {
        const sec = Math.floor((Date.now() - startTime) / 1000);
        const m = String(Math.floor(sec / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        el.textContent = `${m}:${s}`;
    }, 500);
}

function stopTimer(): void {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    const el = document.getElementById('voiceTimer');
    if (el) { el.style.display = 'none'; el.textContent = '00:00'; }
}

function updateRecordingUI(recording: boolean): void {
    const btn = document.getElementById('btnVoice');
    const cancelBtn = document.getElementById('btnVoiceCancel');
    const pending = startPending && !recording;
    if (btn) {
        btn.classList.toggle('recording', recording);
        btn.classList.toggle('arming', pending);
        btn.innerHTML = recording ? ICONS.stop : ICONS.mic;
        btn.title = pending ? t('voice.requesting') : recording ? t('voice.stop') : t('voice.start');
        btn.toggleAttribute('aria-busy', pending);
        if (btn instanceof HTMLButtonElement) btn.disabled = pending;
    }
    if (cancelBtn) {
        cancelBtn.style.display = recording ? 'inline-block' : 'none';
    }
}

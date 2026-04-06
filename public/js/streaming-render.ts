// ── Streaming rAF Renderer ──
// Phase 3/8: throttled markdown rendering during agent streaming
// Prevents flicker by batching renders to 1 per animation frame.

import { renderMarkdown } from './render.js';

export interface StreamState {
    fullText: string;
    element: HTMLElement;
    pendingRAF: number | null;
    isFinalized: boolean;
}

export function createStreamRenderer(el: HTMLElement): StreamState {
    return { fullText: '', element: el, pendingRAF: null, isFinalized: false };
}

export function appendChunk(ss: StreamState, chunk: string): void {
    ss.fullText += chunk;
    if (!ss.pendingRAF && !ss.isFinalized) {
        ss.pendingRAF = requestAnimationFrame(() => {
            ss.pendingRAF = null;
            if (!ss.isFinalized) {
                ss.element.innerHTML = renderMarkdown(ss.fullText) +
                    '<span class="stream-cursor" aria-hidden="true"></span>';
            }
        });
    }
}

export function finalizeStream(ss: StreamState): string {
    ss.isFinalized = true;
    if (ss.pendingRAF) {
        cancelAnimationFrame(ss.pendingRAF);
        ss.pendingRAF = null;
    }
    ss.element.innerHTML = renderMarkdown(ss.fullText);
    return ss.fullText;
}

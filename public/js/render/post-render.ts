// ── Batched post-render scheduler ──
import { renderMermaidBlocks } from './mermaid.js';
import { rehighlightAll } from './highlight.js';
import { bindDiagramZoom } from './svg-actions.js';
import { linkifyFilePaths } from './file-links.js';

let postRenderRAF: number | null = null;
let postRenderTimer: ReturnType<typeof setTimeout> | null = null;

export function schedulePostRender(): void {
    if (postRenderTimer) clearTimeout(postRenderTimer);
    if (postRenderRAF) { cancelAnimationFrame(postRenderRAF); postRenderRAF = null; }
    postRenderTimer = setTimeout(() => {
        postRenderTimer = null;
        postRenderRAF = requestAnimationFrame(() => {
            postRenderRAF = null;
            renderMermaidBlocks();
            rehighlightAll();
            bindDiagramZoom();
            const msgContainer = document.getElementById('chatMessages');
            if (msgContainer) linkifyFilePaths(msgContainer);
        });
    }, 100);
}

export function cancelPostRender(): void {
    if (postRenderTimer) {
        clearTimeout(postRenderTimer);
        postRenderTimer = null;
    }
    if (postRenderRAF) {
        cancelAnimationFrame(postRenderRAF);
        postRenderRAF = null;
    }
}

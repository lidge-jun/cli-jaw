// ── Render Helpers Facade ──
// Public API is kept stable while implementation lives in focused modules.

export { renderMarkdown } from './render/markdown.js';
export { escapeHtml, stripOrchestration, stripPromptLeakage } from './render/html.js';
export { sanitizeHtml } from './render/sanitize.js';
export { shieldMath, unshieldMath } from './render/math.js';
export { rehighlightAll } from './render/highlight.js';
export { linkifyFilePaths } from './render/file-links.js';
export { bindDiagramZoom, openDiagramOverlay } from './render/svg-actions.js';
export {
    renderMermaidBlocks,
    releaseMermaidNodes,
    rerenderMermaidDiagrams,
    prewarmMermaid,
} from './render/mermaid.js';
export { cancelPostRender } from './render/post-render.js';

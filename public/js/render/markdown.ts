// ── Markdown rendering pipeline ──
import { marked, Renderer } from 'marked';
import { t } from '../features/i18n.js';
import { fixCjkPunctuationBoundary } from '../cjk-fix.js';
import { shieldCodeFenceSvg, unshieldCodeFenceSvg, extractTopLevelSvg } from '../diagram/types.js';
import { escapeHtml, stripOrchestration } from './html.js';
import { shieldMath, unshieldMath } from './math.js';
import { sanitizeHtml } from './sanitize.js';
import { unshieldSvgBlocks } from './svg-actions.js';
import { highlightCode, ensureHighlightLanguages } from './highlight.js';
import { schedulePostRender } from './post-render.js';
import { ensureRenderDelegations } from './delegations.js';

// ── marked.js configuration (ES module — always available) ──
let markedReady = false;

function ensureMarked(): boolean {
    if (markedReady) return true;

    const renderer = new Renderer();

    // Code blocks: highlight.js + mermaid + diagram-html detection
    renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
        if (lang === 'mermaid') {
            // Phase 127-F1: store raw source in data attribute, render a skeleton
            // placeholder so users never see raw Mermaid syntax while the diagram loads.
            const encodedCode = encodeURIComponent(text);
            return `<div class="mermaid-container mermaid-pending" data-mermaid-code-raw="${encodedCode}" role="status" aria-label="Diagram loading">
                <div class="mermaid-skeleton">
                    <div class="mermaid-skeleton-spinner"></div>
                    <div class="mermaid-skeleton-text">Rendering diagram…</div>
                </div>
            </div>`;
        }
        // diagram-html: encode as base64, Phase 2 activateWidgets() inflates to sandboxed iframe
        if (lang?.trim().toLowerCase() === 'diagram-html') {
            const encoded = btoa(unescape(encodeURIComponent(text)));
            return `<div class="diagram-widget-pending" data-diagram-html="${encoded}"
                role="status" aria-label="Interactive widget loading">
                <div class="diagram-spinner"></div>
            </div>`;
        }
        const highlighted = highlightCode(text, lang);
        const langDisplay = lang ? escapeHtml(lang) : '';
        const copyLabel = t('code.copy') || 'Copy';
        return `<div class="code-block"><div class="code-header"><span class="code-lang">${langDisplay}</span><button class="code-copy-btn" type="button" aria-label="${escapeHtml(copyLabel)}">${escapeHtml(copyLabel)}</button></div><pre><code class="hljs${lang ? ` language-${escapeHtml(lang)}` : ''}">${highlighted}</code></pre></div>`;
    };

    marked.setOptions({
        renderer,
        gfm: true,
        breaks: false,
    });

    markedReady = true;
    return true;
}

export function renderMarkdown(text: string, isStreaming = false): string {
    const rawCleaned = stripOrchestration(text);
    if (!rawCleaned) return '<em class="text-dim orchestrate-placeholder">' + escapeHtml(t('orchestrator.dispatching')) + '</em>';
    const cleaned = rawCleaned.replace(/\n{3,}/g, '\n\n');

    const { text: fenceShielded, fences } = shieldCodeFenceSvg(cleaned);
    const { text: svgShielded, blocks: svgBlocks } = extractTopLevelSvg(fenceShielded, isStreaming);
    const restored = unshieldCodeFenceSvg(svgShielded, fences);
    const { text: shielded, blocks: mathBlocks } = shieldMath(restored);

    ensureHighlightLanguages();
    ensureMarked();
    const fixed = fixCjkPunctuationBoundary(shielded);
    let html = marked.parse(fixed) as string;
    html = html.replace(/<table/g, '<div class="table-wrapper"><table').replace(/<\/table>/g, '</table></div>');
    html = unshieldMath(html, mathBlocks, isStreaming);
    html = sanitizeHtml(html);
    html = unshieldSvgBlocks(html, svgBlocks);

    if (!isStreaming) {
        schedulePostRender();
    }
    ensureRenderDelegations();

    return html;
}

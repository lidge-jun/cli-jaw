// ── SVG block rendering and diagram action controls ──
import { ICONS } from '../icons.js';
import type { SvgBlock } from '../diagram/types.js';
import { sanitizeHtml } from './sanitize.js';

export function appendMermaidActionBtns(el: HTMLElement): void {
    // Remove existing buttons if present (e.g. re-render)
    el.querySelector('.mermaid-zoom-btn')?.remove();
    el.querySelector('.mermaid-copy-btn')?.remove();
    el.querySelector('.mermaid-save-btn')?.remove();

    const zoomBtn = document.createElement('button');
    zoomBtn.className = 'mermaid-zoom-btn';
    zoomBtn.type = 'button';
    zoomBtn.ariaLabel = 'Expand diagram';
    zoomBtn.title = 'Expand';
    zoomBtn.textContent = '⤢';
    el.appendChild(zoomBtn);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'mermaid-save-btn';
    saveBtn.type = 'button';
    saveBtn.ariaLabel = 'Save as image';
    saveBtn.title = 'Save';
    saveBtn.innerHTML = ICONS.download;
    el.appendChild(saveBtn);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'mermaid-copy-btn';
    copyBtn.type = 'button';
    copyBtn.ariaLabel = 'Copy source';
    copyBtn.title = 'Copy';
    copyBtn.innerHTML = ICONS.copy;
    el.appendChild(copyBtn);
}

// ── Diagram action button event delegation (copy + save) ──
let diagramActionsReady = false;

export function ensureDiagramActionDelegation(): void {
    if (diagramActionsReady) return;
    diagramActionsReady = true;

    document.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;

        // ── Copy buttons ──
        const diagCopyBtn = target?.closest('.diagram-copy-btn') as HTMLElement | null;
        if (diagCopyBtn) {
            const container = diagCopyBtn.closest('.diagram-container') as HTMLElement | null;
            if (!container) return;
            let text = '';
            if (container.dataset['widgetHtml']) {
                try { text = decodeURIComponent(escape(atob(container.dataset['widgetHtml']))); }
                catch { return; }
            } else {
                const svgEl = container.querySelector('svg');
                if (svgEl) text = svgEl.outerHTML;
            }
            if (text) btnFeedback(diagCopyBtn, text, 'copy');
            return;
        }

        const mermaidCopyBtn = target?.closest('.mermaid-copy-btn') as HTMLElement | null;
        if (mermaidCopyBtn) {
            const container = mermaidCopyBtn.closest('.mermaid-container') as HTMLElement | null;
            if (!container) return;
            const code = container.dataset['mermaidCode'] || '';
            if (code) btnFeedback(mermaidCopyBtn, code, 'copy');
            return;
        }

        // ── Save buttons ──
        const diagSaveBtn = target?.closest('.diagram-save-btn') as HTMLElement | null;
        if (diagSaveBtn) {
            const container = diagSaveBtn.closest('.diagram-container') as HTMLElement | null;
            if (!container) return;
            // Widget: request screenshot via bridge
            if (container.dataset['widgetHtml']) {
                const iframe = container.querySelector('iframe') as HTMLIFrameElement | null;
                if (iframe?.contentWindow) {
                    iframe.contentWindow.postMessage({ type: 'jaw-request-screenshot' }, '*');
                    btnFeedback(diagSaveBtn, '', 'save');
                }
                return;
            }
            // SVG: convert to PNG
            const svgEl = container.querySelector('svg');
            if (svgEl) saveSvgAsPng(svgEl, diagSaveBtn);
            return;
        }

        const mermaidSaveBtn = target?.closest('.mermaid-save-btn') as HTMLElement | null;
        if (mermaidSaveBtn) {
            const container = mermaidSaveBtn.closest('.mermaid-container') as HTMLElement | null;
            if (!container) return;
            const svgEl = container.querySelector('svg');
            if (svgEl) saveSvgAsPng(svgEl, mermaidSaveBtn);
            return;
        }
    });
}

function btnFeedback(btn: HTMLElement, text: string, action: 'copy' | 'save'): void {
    const doFeedback = () => {
        const orig = btn.innerHTML;
        btn.innerHTML = ICONS.checkSimple;
        btn.classList.add('copied');
        setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1500);
    };
    if (action === 'copy') {
        navigator.clipboard.writeText(text).then(doFeedback).catch(() => {});
    } else {
        doFeedback();
    }
}

function inlineComputedStyles(original: Element, clone: Element): void {
    const origChildren = original.children;
    const cloneChildren = clone.children;
    const props = ['fill', 'stroke', 'stroke-width', 'color', 'opacity',
        'rx', 'ry', 'font-size', 'font-weight', 'font-family',
        'text-anchor', 'dominant-baseline'];
    for (let i = 0; i < origChildren.length; i++) {
        const oc = origChildren[i];
        const cc = cloneChildren[i];
        if (!oc || !cc) continue;
        const cs = getComputedStyle(oc);
        for (const p of props) {
            const v = cs.getPropertyValue(p);
            if (v) (cc as HTMLElement).style.setProperty(p, v);
        }
        if (oc.children.length) inlineComputedStyles(oc, cc);
    }
}

function saveSvgAsPng(svgEl: SVGElement, btn: HTMLElement): void {
    const clone = svgEl.cloneNode(true) as SVGElement;
    inlineComputedStyles(svgEl, clone);
    const bbox = svgEl.getBoundingClientRect();
    if (!clone.getAttribute('width')) clone.setAttribute('width', String(bbox.width));
    if (!clone.getAttribute('height')) clone.setAttribute('height', String(bbox.height));

    const svgData = new XMLSerializer().serializeToString(clone);
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);
    const img = new Image();
    img.onload = () => {
        const scale = 2; // retina
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth * scale;
        canvas.height = img.naturalHeight * scale;
        const ctx = canvas.getContext('2d')!;
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(blob => {
            if (!blob) return;
            downloadBlob(blob, `diagram-${Date.now()}.png`);
            btnFeedback(btn, '', 'save');
        }, 'image/png');
    };
    img.onerror = () => {
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        downloadBlob(svgBlob, `diagram-${Date.now()}.svg`);
        btnFeedback(btn, '', 'save');
    };
    img.src = dataUrl;
}

function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── SVG Block Rendering (Phase 1) ──

export function renderSvgBlock(block: SvgBlock): string {
    if (block.kind === 'partial') {
        return `<div class="diagram-container diagram-loading" role="status"
            aria-label="Diagram loading"><div class="diagram-spinner"></div></div>`;
    }
    if (block.kind === 'error') {
        return `<div class="diagram-container diagram-error" role="alert">
            Malformed SVG: unclosed element</div>`;
    }
    // Complete SVG — sanitize individually (extracted SVGs bypass main pipeline)
    const sanitized = sanitizeHtml(block.svg);
    return `<div class="diagram-container diagram-svg" tabindex="0"
        role="figure" aria-label="SVG diagram">
        ${sanitized}
        <button class="diagram-save-btn" type="button"
            aria-label="Save as image" title="Save">${ICONS.download}</button>
        <button class="diagram-copy-btn" type="button"
            aria-label="Copy source" title="Copy">${ICONS.copy}</button>
        <button class="diagram-zoom-btn" type="button"
            aria-label="Expand diagram" title="Expand">⤢</button>
    </div>`;
}

export function unshieldSvgBlocks(html: string, blocks: SvgBlock[]): string {
    for (const block of blocks) {
        const pattern = `<div\\b[^>]*?\\bdata-jaw-svg="${block.id}"[^>]*></div>`;
        const re = new RegExp(pattern, 'g');
        const rendered = renderSvgBlock(block);
        // Use function replacement to avoid $& $' $` special patterns in SVG content
        html = html.replace(re, () => rendered);
    }
    return html;
}

export type DiagramOverlayKind = 'inline-svg' | 'mermaid';

export function bindDiagramZoom(scope?: HTMLElement | Document): void {
    const root = scope || document;
    root.querySelectorAll('.diagram-zoom-btn, .mermaid-zoom-btn').forEach(btn => {
        if ((btn as HTMLElement).dataset['bound']) return;
        (btn as HTMLElement).dataset['bound'] = '1';
        btn.addEventListener('click', () => {
            if (btn.closest('.diagram-widget')) return;
            const inlineContainer = btn.closest('.diagram-container') as HTMLElement | null;
            const mermaidContainer = btn.closest('.mermaid-container') as HTMLElement | null;
            const container = inlineContainer || mermaidContainer;
            if (!container) return;
            const clone = container.cloneNode(true) as HTMLElement;
            clone.querySelectorAll('.diagram-zoom-btn, .mermaid-zoom-btn, .diagram-copy-btn, .diagram-save-btn, .mermaid-copy-btn, .mermaid-save-btn')
                .forEach(b => b.remove());
            const kind: DiagramOverlayKind = mermaidContainer && !inlineContainer ? 'mermaid' : 'inline-svg';
            openDiagramOverlay(clone.innerHTML, kind);
        });
    });
}

export function openDiagramOverlay(innerHtml: string, kind: DiagramOverlayKind = 'inline-svg'): void {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overlay = document.createElement('div');
    overlay.className = 'diagram-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Expanded diagram');
    // Re-sanitize to prevent mXSS from double HTML parsing
    const safeHtml = sanitizeHtml(innerHtml);
    const contentClass = kind === 'inline-svg'
        ? 'diagram-overlay-content diagram-svg-overlay'
        : 'diagram-overlay-content';
    overlay.innerHTML = [
        '<div class="', contentClass, '">', safeHtml, '</div>',
        '<button class="diagram-overlay-close" type="button" aria-label="Close">✕</button>',
    ].join('');

    // Ensure SVGs scale inside overlay: add viewBox if missing, remove fixed dimensions
    overlay.querySelectorAll<SVGSVGElement>('.diagram-overlay-content svg').forEach(svg => {
        if (!svg.getAttribute('viewBox')) {
            const w = svg.getAttribute('width') || svg.getBBox?.()?.width;
            const h = svg.getAttribute('height') || svg.getBBox?.()?.height;
            if (w && h) svg.setAttribute('viewBox', '0 0 ' + parseFloat(String(w)) + ' ' + parseFloat(String(h)));
        }
        svg.removeAttribute('width');
        svg.removeAttribute('height');
    });

    const closeBtn = overlay.querySelector('.diagram-overlay-close') as HTMLElement;

    const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { close(); return; }
        if (e.key === 'Tab') {
            const focusable = overlay.querySelectorAll<HTMLElement>(
                'button, [href], [tabindex]:not([tabindex="-1"])');
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        }
    };

    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    closeBtn.focus();
}

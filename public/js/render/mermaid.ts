// ── Mermaid deferred rendering ──
import { t } from '../features/i18n.js';
import { ICONS } from '../icons.js';
import { escapeHtml } from './html.js';
import { sanitizeMermaidSvg } from './sanitize.js';
import { appendMermaidActionBtns, bindDiagramZoom } from './svg-actions.js';

interface MermaidApi {
    initialize(config: Record<string, unknown>): void;
    render(id: string, code: string): Promise<{ svg: string }>;
}

// Lazy mermaid: loaded on first diagram encounter
let mermaidModule: MermaidApi | null = null;

// Serialise all Mermaid render calls — concurrent renders corrupt shared internal state.
let mermaidQueue: Promise<void> = Promise.resolve();

function getMermaidThemeVars() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return isLight ? {
        primaryColor: '#e2e8f0',
        primaryTextColor: '#1a202c',
        primaryBorderColor: '#a0aec0',
        lineColor: '#718096',
        secondaryColor: '#ebf8ff',
        tertiaryColor: '#f7fafc',
        background: 'transparent',
        mainBkg: '#e2e8f0',
        nodeBorder: '#a0aec0',
        clusterBkg: '#f7fafc',
        clusterBorder: '#cbd5e0',
        titleColor: '#1a202c',
        edgeLabelBackground: '#f7fafc',
    } : {
        primaryColor: '#2d3748',
        primaryTextColor: '#e2e8f0',
        primaryBorderColor: '#4a5568',
        lineColor: '#718096',
        secondaryColor: '#1a365d',
        tertiaryColor: '#1a202c',
        background: 'transparent',
        mainBkg: '#2d3748',
        nodeBorder: '#4a5568',
        clusterBkg: '#1a202c',
        clusterBorder: '#2d3748',
        titleColor: '#e2e8f0',
        edgeLabelBackground: '#1a202c',
    };
}

async function ensureMermaidLoaded() {
    if (!mermaidModule) {
        const loader = await import('../mermaid-loader.js');
        mermaidModule = loader.loadMermaid();
    }
    return mermaidModule;
}

// Re-apply theme config immediately before every render() call.
// Mermaid's internal config can drift after parse()/render() due to
// directive resets — never cache, always re-initialise.
function applyMermaidTheme() {
    mermaidModule!.initialize({
        startOnLoad: false,
        theme: 'base',
        htmlLabels: false,
        themeVariables: getMermaidThemeVars(),
        securityLevel: 'strict',
        suppressErrorRendering: true,
    });
}

// ── Mermaid deferred rendering (lazy-loaded) ──
let mermaidId = 0;

/** Re-render all existing Mermaid diagrams (call on theme toggle). */
export async function rerenderMermaidDiagrams(): Promise<void> {
    const rendered = document.querySelectorAll('.mermaid-rendered');
    if (!rendered.length) return;
    mermaidQueue = mermaidQueue.then(async () => {
        const mm = await ensureMermaidLoaded();
        for (const el of rendered) {
            const htmlEl = el as HTMLElement;
            const code = htmlEl.dataset['mermaidCode'];
            if (!code || !htmlEl.isConnected) continue;
            const id = `mermaid-${++mermaidId}`;
            try {
                applyMermaidTheme();
                const { svg } = await mm.render(id, code);
                if (!htmlEl.isConnected) continue;
                htmlEl.innerHTML = sanitizeMermaidSvg(svg);
                appendMermaidActionBtns(htmlEl);
                bindDiagramZoom(htmlEl);
            } catch { /* keep existing render on failure */ }
        }
    }).catch(err => {
        console.error('[mermaid:queue] rerender failed, keeping queue alive:', err);
    });
    await mermaidQueue;
}

// Lazy Mermaid rendering — only render blocks near the viewport
let mermaidObserver: IntersectionObserver | null = null;

function ensureMermaidObserver(): void {
    if (mermaidObserver) return;
    mermaidObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target as HTMLElement;
            if (!el.classList.contains('mermaid-pending')) continue;
            mermaidObserver!.unobserve(el);
            renderSingleMermaid(el);
        }
    }, { rootMargin: '200px' }); // pre-render 200px before visible
}

function renderMermaidError(el: HTMLElement, code: string, errMsg: string): void {
    el.classList.remove('mermaid-rendered');
    el.innerHTML = `
        <div class="mermaid-error">
            <div class="mermaid-error-title">${ICONS.warning} ${escapeHtml(t('mermaid.renderFail') || 'Mermaid render failed')}</div>
            <div class="mermaid-error-msg">${escapeHtml(errMsg.slice(0, 200))}</div>
            <pre class="mermaid-error-code"><code>${escapeHtml(code)}</code></pre>
        </div>`;
}

async function renderSingleMermaidImpl(el: HTMLElement): Promise<void> {
    if (!el.isConnected) {
        delete el.dataset['mermaidQueued'];
        delete el.dataset['mermaidInflight'];
        return;
    }
    el.classList.remove('mermaid-pending');
    // Phase 127-F1: raw source lives in data attribute (skeleton DOM has no source text).
    const encoded = el.dataset['mermaidCodeRaw'] || '';
    const code = encoded ? decodeURIComponent(encoded) : (el.textContent || '');
    el.dataset['mermaidCode'] = code;
    const id = `mermaid-${++mermaidId}`;
    el.dataset['mermaidInflight'] = '1';
    try {
        const mm = await ensureMermaidLoaded();
        // Apply theme immediately before render — no intermediate parse()
        // that could reset Mermaid's internal config state.
        applyMermaidTheme();
        const { svg } = await mm.render(id, code);
        if (!el.isConnected) {
            return;
        }
        el.innerHTML = sanitizeMermaidSvg(svg);
        el.classList.add('mermaid-rendered');
        delete el.dataset['mermaidCodeRaw'];
        appendMermaidActionBtns(el);
        bindDiagramZoom(el);
    } catch (err: unknown) {
        const errMsg = (err as { message?: string; str?: string })?.message
            || (err as { str?: string })?.str || 'Unknown error';
        renderMermaidError(el, code, errMsg);
    } finally {
        delete el.dataset['mermaidQueued'];
        delete el.dataset['mermaidInflight'];
    }
}

// Serialise renders to prevent concurrent Mermaid operations from
// corrupting shared internal state (theme config, diagram registry).
function renderSingleMermaid(el: HTMLElement): void {
    // Phase 127-N2: synchronous queued guard prevents duplicate enqueueing when
    // renderMermaidBlocks immediate mode fires repeatedly (e.g. VS onPostRender
    // on every scroll). Class/dataset is set right away so the next pass skips.
    if (el.dataset['mermaidQueued'] === '1') return;
    el.dataset['mermaidQueued'] = '1';
    // Phase 127-F6: .catch tail keeps the queue alive after any rejection so
    // one bad render cannot permanently block subsequent diagrams.
    mermaidQueue = mermaidQueue
        .then(() => renderSingleMermaidImpl(el))
        .catch(err => {
            console.error('[mermaid:queue] render failed, keeping queue alive:', err);
        });
}

/**
 * Phase 127-F5: exposed so streaming finalize / virtual-scroll hooks can push
 * new mermaid blocks through the pipeline without waiting for schedulePostRender.
 *
 * @param scope DOM subtree to scan (defaults to whole document)
 * @param opts.immediate if true, render blocks already in (or near) viewport
 *                       right now instead of waiting for the observer.
 */
export async function renderMermaidBlocks(
    scope?: HTMLElement | Document,
    opts: { immediate?: boolean } = {},
): Promise<void> {
    const root = scope || document;
    const pending = root.querySelectorAll<HTMLElement>('.mermaid-pending');
    if (!pending.length) return;
    ensureMermaidObserver();
    for (const el of pending) {
        if (el.dataset['mermaidQueued'] === '1') continue;   // N2 guard
        if (opts.immediate) {
            const rect = el.getBoundingClientRect();
            const vh = window.innerHeight || document.documentElement.clientHeight;
            const inView = rect.bottom >= -200 && rect.top <= vh + 200;
            if (inView) {
                mermaidObserver!.unobserve(el);
                renderSingleMermaid(el);
                continue;
            }
        }
        mermaidObserver!.observe(el);
    }
}

export function releaseMermaidNodes(scope: HTMLElement): void {
    if (!mermaidObserver) return;
    const selector = [
        '.mermaid-pending',
        '[data-mermaid-queued="1"]',
        '[data-mermaid-inflight="1"]',
    ].join(',');
    const nodes: HTMLElement[] = [];
    if (scope.matches(selector)) nodes.push(scope);
    scope.querySelectorAll<HTMLElement>(selector).forEach((el) => nodes.push(el));
    for (const el of nodes) {
        mermaidObserver.unobserve(el);
        delete el.dataset['mermaidQueued'];
        delete el.dataset['mermaidQueuedAt'];
        delete el.dataset['mermaidInflight'];
        if (!el.classList.contains('mermaid-rendered')
            && (el.dataset['mermaidCodeRaw'] || el.dataset['mermaidCode'])) {
            el.classList.add('mermaid-pending');
        }
    }
}

/**
 * Phase 127-F2: prewarm Mermaid module at idle time so the first diagram's
 * cold-start does not block rendering. Safe to call multiple times.
 */
export function prewarmMermaid(): void {
    if (mermaidModule) return;
    const run = () => { void ensureMermaidLoaded().catch(() => { /* silent */ }); };
    if (typeof (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback === 'function') {
        (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout?: number }) => void })
            .requestIdleCallback(run, { timeout: 2000 });
    } else {
        setTimeout(run, 500);
    }
}

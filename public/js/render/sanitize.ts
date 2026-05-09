// ── XSS sanitization helpers ──
import { getDOMPurify } from '../sanitizer.js';

function purifier() {
    return getDOMPurify();
}

// Mermaid SVG sanitizer — allows <style> (required for Mermaid theming)
// Separate from sanitizeHtml() which blocks <style> for user-supplied SVGs.
// Mermaid is configured with htmlLabels:false so labels use SVG <text>,
// not <foreignObject> + HTML. This avoids DOMPurify namespace issues.
export function sanitizeMermaidSvg(svg: string): string {
    const clean = purifier().sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: [
            'script', 'iframe', 'object', 'embed', 'form', 'input',
            'foreignObject', 'animate', 'set', 'animateTransform', 'animateMotion',
        ],
        FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur',
                      'background'],
    });
    // Sanitize CSS inside <style> blocks: strip @import, @font-face, external url()
    const div = document.createElement('div');
    div.innerHTML = clean;
    for (const style of div.querySelectorAll('style')) {
        let css = style.textContent || '';
        css = css.replace(/@import\b[^;]*;?/gi, '/* stripped */');
        css = css.replace(/@font-face\s*\{[^}]*\}/gi, '/* stripped */');
        css = css.replace(/url\s*\(\s*(?!['"]?#)[^)]*\)/gi, 'none');
        style.textContent = css;
    }
    return div.innerHTML;
}

// ── XSS sanitization (hardened for inline SVG — Phase 1) ──
export function sanitizeHtml(html: string): string {
    return purifier().sanitize(html, {
        USE_PROFILES: { html: true, svg: true, svgFilters: true },
        FORBID_TAGS: [
            'script', 'style', 'iframe', 'object', 'embed', 'form', 'input',
            // SVG security: block animation + foreignObject (script injection vectors)
            'foreignObject', 'animate', 'set', 'animateTransform', 'animateMotion',
        ],
        FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur',
                      'background'],  // legacy HTML attr that triggers remote fetch
        ADD_TAGS: ['use'],
        ADD_ATTR: ['aria-hidden', 'xmlns', 'viewBox', 'role', 'aria-label',
                   'data-jaw-svg', 'data-jaw-kind', 'data-mermaid-code-raw',
                   'href', 'xlink:href'],
    });
}

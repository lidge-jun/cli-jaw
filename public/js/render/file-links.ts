// ── File path linkification and click-to-open delegation ──
import { apiJson } from '../api.js';

// ── File path linkification (click-to-open in Finder) ──

const FILE_PATH_RE_G = /(?:~\/[^\s)`\]"'<>]+|\/(?:Users|home|tmp|var|opt|private)\/[^\s)`\]"'<>]+)/g;
const TRAILING_PUNCT_RE = /[.,!?:;]+$/;
const LOCAL_FILE_HREF_RE = /^(?:~\/|\/(?:Users|home|tmp|var|opt|private)\/)/;

function isLocalFileHref(href: string): boolean {
    return LOCAL_FILE_HREF_RE.test(href);
}

function openLocalPath(path: string, el?: HTMLElement | null): void {
    if (el) el.classList.add('opening');

    apiJson<{ ok?: boolean; error?: string }>('/api/file/open', 'POST', { path })
        .then(data => {
            el?.classList.remove('opening');
            if (data?.ok !== false) {
                el?.classList.add('opened');
                setTimeout(() => el?.classList.remove('opened'), 1500);
            } else {
                el?.classList.add('open-failed');
                if (el) el.title = data?.error || 'Failed to open';
                setTimeout(() => {
                    el?.classList.remove('open-failed');
                    if (el) el.title = '';
                }, 2000);
            }
        })
        .catch(() => {
            el?.classList.remove('opening');
            el?.classList.add('open-failed');
            setTimeout(() => el?.classList.remove('open-failed'), 2000);
        });
}

/**
 * Walk text nodes inside container, wrap file paths in clickable spans.
 * Idempotent — skips already-linkified paths.
 * Skips: <pre>, <a>, <button>, .file-path-link
 */
export function linkifyFilePaths(container: HTMLElement): void {
    const SKIP_TAGS = new Set(['PRE', 'A', 'BUTTON', 'TEXTAREA', 'INPUT', 'SCRIPT', 'STYLE']);

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            let el = node.parentElement;
            while (el && el !== container) {
                if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
                if (el.classList.contains('file-path-link')) return NodeFilter.FILTER_REJECT;
                if (el.tagName === 'CODE' && el.parentElement?.tagName === 'PRE') {
                    return NodeFilter.FILTER_REJECT;
                }
                el = el.parentElement;
            }
            return NodeFilter.FILTER_ACCEPT;
        },
    });

    // Collect text nodes with matches, grouped by node
    const nodeMatches = new Map<Text, { index: number; raw: string; clean: string }[]>();
    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
        const text = textNode.textContent || '';
        FILE_PATH_RE_G.lastIndex = 0;
        let m: RegExpExecArray | null;
        const hits: { index: number; raw: string; clean: string }[] = [];
        while ((m = FILE_PATH_RE_G.exec(text))) {
            const raw = m[0];
            const clean = raw.replace(TRAILING_PUNCT_RE, '');
            if (clean.length < 4) continue;
            hits.push({ index: m.index, raw, clean });
        }
        if (hits.length) nodeMatches.set(textNode, hits);
    }

    // Replace each text node once — build full fragment with all matches
    for (const [node, hits] of nodeMatches) {
        const text = node.textContent || '';
        const parent = node.parentNode;
        if (!parent) continue;

        const frag = document.createDocumentFragment();
        let cursor = 0;

        for (const { index, raw, clean } of hits) {
            // Text before this match
            if (index > cursor) {
                frag.appendChild(document.createTextNode(text.slice(cursor, index)));
            }
            // The clickable span
            const span = document.createElement('span');
            span.className = 'file-path-link';
            span.setAttribute('data-file-path', clean);
            span.setAttribute('role', 'button');
            span.setAttribute('tabindex', '0');
            span.textContent = clean;
            frag.appendChild(span);
            // Trailing punctuation that was trimmed
            const trailingPunct = raw.slice(clean.length);
            if (trailingPunct) frag.appendChild(document.createTextNode(trailingPunct));
            cursor = index + raw.length;
        }

        // Remaining text after last match
        if (cursor < text.length) {
            frag.appendChild(document.createTextNode(text.slice(cursor)));
        }

        parent.replaceChild(frag, node);
    }
}

// ── File path click event delegation (one-time setup) ──
let filePathDelegationReady = false;

export function ensureFilePathDelegation(): void {
    if (filePathDelegationReady) return;
    filePathDelegationReady = true;

    document.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const anchor = target?.closest('a') as HTMLAnchorElement | null;
        const href = anchor?.getAttribute('href') || '';
        if (anchor && isLocalFileHref(href)) {
            e.preventDefault();
            anchor.classList.add('file-path-link');
            openLocalPath(href, anchor);
            return;
        }

        const link = target?.closest('.file-path-link') as HTMLElement | null;
        if (!link) return;

        const filePath = link.getAttribute('data-file-path');
        if (!filePath) return;
        openLocalPath(filePath, link);
    });

    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const target = e.target as HTMLElement;
        if (target?.classList.contains('file-path-link')) {
            e.preventDefault();
            target.click();
        }
    });
}

// Forward Alt-modified keyboard shortcuts from iframe to parent manager window.
// Only active when the page is embedded as an iframe (preview mode).

const FORWARD_KEYS = new Set(['j', 'k', 'i', 'n', 'p']);

export function initPreviewShortcutBridge(): void {
    if (window.parent === window) return;

    document.addEventListener('keydown', (e) => {
        if (!e.altKey) return;
        if (e.ctrlKey || e.metaKey) return;
        let key = e.key.toLowerCase();
        // macOS Option+letter produces special chars (e.g. ∆ for Alt+J).
        if (key.length !== 1 || !FORWARD_KEYS.has(key)) {
            if (e.code?.startsWith('Key')) key = e.code.slice(3).toLowerCase();
        }
        if (!FORWARD_KEYS.has(key)) return;

        e.preventDefault();
        try {
            window.parent.postMessage({
                type: 'jaw-preview-shortcut',
                key,
                altKey: true,
                shiftKey: e.shiftKey,
            }, '*');
        } catch { /* cross-origin guard */ }
    });
}

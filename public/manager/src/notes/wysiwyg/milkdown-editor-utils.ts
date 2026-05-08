import { notesImageSrc } from '../rendering/markdown-render-security';

export function focusEditable(root: HTMLDivElement | null): void {
    root?.querySelector<HTMLElement>('.ProseMirror')?.focus();
}

export function htmlToPlainText(html: string): string {
    const element = document.createElement('div');
    element.innerHTML = html;
    return element.textContent ?? '';
}

export function isCodeBlockRawPasteTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement
        && Boolean(target.closest('textarea.notes-code-raw'));
}

export function normalizeCodeLanguage(language: string): string {
    return language.trim().toLowerCase().replace(/[^a-z0-9_+-]/g, '');
}

export function refreshMilkdownAssetImages(root: HTMLDivElement | null): void {
    if (!root) return;
    root.querySelectorAll<HTMLImageElement>('img[src]').forEach(image => {
        const originalSrc = image.dataset['notesOriginalSrc'] || image.getAttribute('src') || '';
        if (!originalSrc) return;
        const resolvedSrc = notesImageSrc(originalSrc);
        if (!resolvedSrc) return;
        image.dataset['notesOriginalSrc'] = originalSrc;
        if (image.getAttribute('src') !== resolvedSrc) image.setAttribute('src', resolvedSrc);
    });
}

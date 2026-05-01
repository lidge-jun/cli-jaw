import type { WysiwygPasteInput, WysiwygPastePolicy, WysiwygPasteResult } from './wysiwyg-adapter-types';

function htmlToInertText(html: string): string {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content.textContent ?? '';
}

function hasUnsafeUrl(text: string): boolean {
    return /javascript\s*:/i.test(text);
}

export function handleDefaultWysiwygPaste(input: WysiwygPasteInput): WysiwygPasteResult {
    const plain = input.textPlain?.trimEnd() ?? '';
    if (plain.length > 0) {
        if (hasUnsafeUrl(plain)) return { kind: 'insert-text', text: plain.replace(/javascript\s*:/gi, 'blocked:') };
        return { kind: 'insert-text', text: plain };
    }

    const html = input.textHtml ?? '';
    if (html.length === 0) return { kind: 'reject', reason: 'empty paste' };
    const inertText = htmlToInertText(html).trimEnd();
    if (inertText.length === 0) return { kind: 'reject', reason: 'html paste contained no text' };
    if (hasUnsafeUrl(inertText)) return { kind: 'insert-text', text: inertText.replace(/javascript\s*:/gi, 'blocked:') };
    return { kind: 'insert-text', text: inertText };
}

export const defaultWysiwygPastePolicy: WysiwygPastePolicy = {
    handlePaste: handleDefaultWysiwygPaste,
};

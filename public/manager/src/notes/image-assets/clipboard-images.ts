const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const EXTENSION_BY_MIME: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

const DATA_IMAGE_RE = /<img\b[^>]*\bsrc=["'](data:(image\/(?:png|jpeg|webp|gif));base64,([^"']+))["'][^>]*>/i;
const HTML_IMAGE_SRC_RE = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i;

function isAllowedImage(file: File | null): file is File {
    return Boolean(file && ALLOWED_IMAGE_TYPES.has(file.type));
}

function fileFromDataUrl(mime: string, base64: string): File | null {
    if (!ALLOWED_IMAGE_TYPES.has(mime)) return null;
    try {
        const binary = atob(base64.replace(/\s+/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        const extension = EXTENSION_BY_MIME[mime] ?? 'png';
        return new File([bytes], `pasted-image.${extension}`, { type: mime });
    } catch {
        console.warn('[notes-image-paste] Failed to decode clipboard image data URL');
        return null;
    }
}

function namedClipboardFile(file: File): File {
    if (file.name) return file;
    const extension = EXTENSION_BY_MIME[file.type] ?? 'png';
    return new File([file], `pasted-image.${extension}`, {
        type: file.type,
        lastModified: file.lastModified,
    });
}

export function firstClipboardImage(data: DataTransfer | null): File | null {
    if (!data) return null;
    for (const item of Array.from(data.items ?? [])) {
        if (item.kind !== 'file' || !ALLOWED_IMAGE_TYPES.has(item.type)) continue;
        const file = item.getAsFile();
        if (isAllowedImage(file)) return namedClipboardFile(file);
    }
    for (const file of Array.from(data.files ?? [])) {
        if (isAllowedImage(file)) return namedClipboardFile(file);
    }
    const html = data.getData?.('text/html') ?? '';
    const match = DATA_IMAGE_RE.exec(html);
    if (match) {
        const [, , mime, base64] = match;
        return fileFromDataUrl(mime, base64);
    }
    return null;
}

const REMOTE_IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp)(?:\?|#|$)/i;

function cleanRemoteImageUrl(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
}

function looksLikeImageUrl(url: string): boolean {
    try { return REMOTE_IMAGE_EXT_RE.test(new URL(url).pathname); } catch { return false; }
}

export function firstRemoteClipboardImageUrl(data: DataTransfer | null): string | null {
    if (!data) return null;
    const html = data.getData?.('text/html') ?? '';
    const htmlMatch = HTML_IMAGE_SRC_RE.exec(html);
    if (htmlMatch) {
        const url = cleanRemoteImageUrl(htmlMatch[1]);
        if (url) return url;
    }
    const uriList = data.getData?.('text/uri-list') ?? '';
    for (const line of uriList.split(/\r?\n/)) {
        if (!line || line.startsWith('#')) continue;
        const url = cleanRemoteImageUrl(line);
        if (url && looksLikeImageUrl(url)) return url;
    }
    const plain = cleanRemoteImageUrl(data.getData?.('text/plain') ?? '');
    return plain && looksLikeImageUrl(plain) ? plain : null;
}

export function hasImportableClipboardImage(data: DataTransfer | null): boolean {
    return Boolean(firstClipboardImage(data) || firstRemoteClipboardImageUrl(data));
}

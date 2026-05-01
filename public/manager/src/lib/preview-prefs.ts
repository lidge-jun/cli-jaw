const STORAGE_KEY = 'jaw.previewEnabled';

export function loadPreviewEnabled(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null) return false;
        return raw === 'true';
    } catch {
        return false;
    }
}

export function savePreviewEnabled(value: boolean): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
    } catch {
        // Storage may be disabled (private mode); fall through silently.
    }
}

export const PREVIEW_ENABLED_STORAGE_KEY = STORAGE_KEY;

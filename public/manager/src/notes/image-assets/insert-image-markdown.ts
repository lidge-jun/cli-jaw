import type { EditorView } from '@codemirror/view';
import { uploadNoteAsset, uploadRemoteNoteAsset } from '../../api';
import { firstClipboardImage, firstRemoteClipboardImageUrl, hasImportableClipboardImage } from './clipboard-images';

export type NotesImagePasteOptions = {
    notePath: string;
    onError?: (error: Error) => void;
};

function errorFromUnknown(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

const NOTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

async function compressImageFile(file: File, maxBytes: number): Promise<File> {
    const bitmap = await createImageBitmap(file);
    const maxDim = 4096;
    let { width, height } = bitmap;
    if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
    }
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const name = file.name.replace(/\.\w+$/, '') + '.jpg';
    for (const quality of [0.85, 0.7, 0.5, 0.3]) {
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        if (blob.size <= maxBytes) {
            return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
        }
    }
    const half = new OffscreenCanvas(Math.round(width / 2), Math.round(height / 2));
    const halfCtx = half.getContext('2d');
    if (!halfCtx) throw new Error('Canvas 2D context unavailable');
    halfCtx.drawImage(canvas, 0, 0, half.width, half.height);
    const blob = await half.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    if (blob.size > maxBytes) throw new Error('Image too large even after compression');
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
}

export async function uploadClipboardImageMarkdown(notePath: string, data: DataTransfer | null): Promise<string | null> {
    let image = firstClipboardImage(data);
    const remoteUrl = image ? null : firstRemoteClipboardImageUrl(data);
    if (!image && !remoteUrl) return null;
    if (image && image.size > NOTE_IMAGE_MAX_BYTES) {
        image = await compressImageFile(image, NOTE_IMAGE_MAX_BYTES);
    }
    const result = image
        ? await uploadNoteAsset(notePath, image)
        : await uploadRemoteNoteAsset(notePath, remoteUrl!);
    return result.markdown;
}

export function handleImageDataTransfer(
    event: ClipboardEvent | DragEvent,
    view: EditorView,
    options: NotesImagePasteOptions,
): boolean {
    const data = 'clipboardData' in event ? event.clipboardData : event.dataTransfer;
    if (!hasImportableClipboardImage(data)) return false;
    const textFallback = data?.getData('text/plain') ?? '';
    event.preventDefault();
    void uploadClipboardImageMarkdown(options.notePath, data)
        .then(result => {
            if (result) view.dispatch(view.state.replaceSelection(result));
        })
        .catch(error => {
            if (textFallback) view.dispatch(view.state.replaceSelection(textFallback));
            options.onError?.(errorFromUnknown(error));
        });
    return true;
}

export function handleClipboardImagePaste(
    event: ClipboardEvent,
    view: EditorView,
    options: NotesImagePasteOptions,
): boolean {
    return handleImageDataTransfer(event, view, options);
}

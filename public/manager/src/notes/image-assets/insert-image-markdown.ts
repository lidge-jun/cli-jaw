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

export async function uploadClipboardImageMarkdown(notePath: string, data: DataTransfer | null): Promise<string | null> {
    const image = firstClipboardImage(data);
    const remoteUrl = image ? null : firstRemoteClipboardImageUrl(data);
    if (!image && !remoteUrl) return null;
    if (image && image.size > NOTE_IMAGE_MAX_BYTES) {
        throw new Error('Image exceeds 5 MB limit');
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

import type {
    WysiwygEditorAdapter,
    WysiwygMarkdownChange,
    WysiwygPastePolicy,
    WysiwygSetMarkdownOptions,
    WysiwygThemeTokens,
} from '../../../public/manager/src/notes/wysiwyg/wysiwyg-adapter-types';

export class FakeWysiwygAdapter implements WysiwygEditorAdapter {
    private markdown = '';
    private callbacks = new Set<(change: WysiwygMarkdownChange) => void>();

    mounted = false;
    active = false;
    readOnly = false;
    focused = false;
    theme: WysiwygThemeTokens | null = null;
    pastePolicy: WysiwygPastePolicy | null = null;

    mount(_container: HTMLElement): void {
        this.mounted = true;
    }

    destroy(): void {
        this.mounted = false;
        this.callbacks.clear();
    }

    focus(): void {
        this.focused = true;
    }

    getMarkdown(): string {
        return this.markdown;
    }

    setMarkdown(markdown: string, options: WysiwygSetMarkdownOptions = {}): void {
        this.markdown = markdown;
        if (options.emitChange) this.emit({ markdown, origin: 'set-markdown' });
    }

    onMarkdownChange(callback: (change: WysiwygMarkdownChange) => void): () => void {
        this.callbacks.add(callback);
        return () => {
            this.callbacks.delete(callback);
        };
    }

    setActive(active: boolean): void {
        this.active = active;
    }

    setReadOnly(readOnly: boolean): void {
        this.readOnly = readOnly;
    }

    setTheme(tokens: WysiwygThemeTokens): void {
        this.theme = tokens;
    }

    setPastePolicy(policy: WysiwygPastePolicy): void {
        this.pastePolicy = policy;
    }

    simulateUserEdit(markdown: string): void {
        this.markdown = markdown;
        this.emit({ markdown, origin: 'user' });
    }

    private emit(change: WysiwygMarkdownChange): void {
        for (const callback of this.callbacks) callback(change);
    }
}

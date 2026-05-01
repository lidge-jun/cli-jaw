export type WysiwygChangeOrigin =
    | 'user'
    | 'set-markdown'
    | 'paste'
    | 'undo'
    | 'redo'
    | 'adapter-sync';

export type WysiwygMarkdownChange = {
    markdown: string;
    origin: WysiwygChangeOrigin;
};

export type WysiwygThemeTokens = {
    colorText: string;
    colorMuted: string;
    colorCanvas: string;
    colorCanvasSoft: string;
    colorBorder: string;
    colorAccent: string;
    colorDanger: string;
    fontBody: string;
    fontMono: string;
};

export type WysiwygPasteInput = {
    textPlain: string | null;
    textHtml: string | null;
};

export type WysiwygPasteResult =
    | { kind: 'insert-markdown'; markdown: string }
    | { kind: 'insert-text'; text: string }
    | { kind: 'reject'; reason: string };

export type WysiwygPastePolicy = {
    handlePaste(input: WysiwygPasteInput): WysiwygPasteResult;
};

export type WysiwygSetMarkdownOptions = {
    preserveUndo?: boolean;
    emitChange?: boolean;
};

export type WysiwygEditorAdapter = {
    mount(container: HTMLElement): void;
    destroy(): void;
    focus(): void;
    getMarkdown(): string;
    setMarkdown(markdown: string, options?: WysiwygSetMarkdownOptions): void;
    onMarkdownChange(callback: (change: WysiwygMarkdownChange) => void): () => void;
    setActive(active: boolean): void;
    setReadOnly(readOnly: boolean): void;
    setTheme(tokens: WysiwygThemeTokens): void;
    setPastePolicy(policy: WysiwygPastePolicy): void;
};

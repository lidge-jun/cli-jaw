import mermaid from 'mermaid';

export interface MermaidApi {
    initialize(config: Record<string, unknown>): void;
    render(id: string, code: string): Promise<{ svg: string }>;
    setParseErrorHandler(handler: () => void): void;
}

export function loadMermaid(): MermaidApi {
    mermaid.setParseErrorHandler(() => {
        // Keep Mermaid syntax failures local to the message block fallback UI.
    });
    return mermaid as unknown as MermaidApi;
}

export type JawCeoOpenAiKeySource = 'deps' | 'env' | 'settings' | 'none';

export type JawCeoOpenAiKeyResolution = {
    value: string;
    source: JawCeoOpenAiKeySource;
};

const OPENAI_API_KEY_PATTERN = /\b(sk-[A-Za-z0-9_-]{16,})\b/;

export function extractOpenAiApiKey(input: unknown): string {
    const raw = String(input || '').trim();
    return raw.match(OPENAI_API_KEY_PATTERN)?.[1] || '';
}

export function hasInvalidOpenAiApiKeyInput(input: unknown): boolean {
    const raw = String(input || '').trim();
    return !!raw && !extractOpenAiApiKey(raw);
}

export function resolveJawCeoOpenAiApiKey(args: {
    override?: unknown;
    env?: unknown;
    settings?: unknown;
}): JawCeoOpenAiKeyResolution {
    const fromDeps = extractOpenAiApiKey(args.override);
    if (fromDeps) return { value: fromDeps, source: 'deps' };
    const fromEnv = extractOpenAiApiKey(args.env);
    if (fromEnv) return { value: fromEnv, source: 'env' };
    const fromSettings = extractOpenAiApiKey(args.settings);
    if (fromSettings) return { value: fromSettings, source: 'settings' };
    return { value: '', source: 'none' };
}

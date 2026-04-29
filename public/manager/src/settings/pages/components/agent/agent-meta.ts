export type CliMeta = {
    label: string;
    models: ReadonlyArray<string>;
    efforts: ReadonlyArray<string>;
};

export type PerCliEntry = {
    model?: string;
    effort?: string;
    fastMode?: boolean;
    contextWindowSize?: number;
    contextWindowCompactLimit?: number;
    [key: string]: unknown;
};

export type ActiveOverride = {
    model?: string;
    effort?: string;
};

export const CLI_META: Record<string, CliMeta> = {
    claude: {
        label: 'Claude',
        models: ['claude-opus-4.7', 'claude-sonnet-4.6', 'claude-haiku-4.5'],
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    },
    codex: {
        label: 'Codex',
        models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex'],
        efforts: ['low', 'medium', 'high', 'xhigh'],
    },
    gemini: {
        label: 'Gemini',
        models: ['gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-3-flash-preview'],
        efforts: [],
    },
    opencode: {
        label: 'OpenCode',
        models: ['opencode-go/kimi-k2.6', 'opencode-go/glm-5.1'],
        efforts: ['minimal', 'low', 'high', 'max'],
    },
    copilot: {
        label: 'Copilot',
        models: ['gpt-5.5', 'claude-opus-4.7', 'claude-sonnet-4.6', 'gpt-5.4'],
        efforts: ['low', 'medium', 'high'],
    },
};

export function metaFor(cli: string): CliMeta {
    return CLI_META[cli] || { label: cli, models: [], efforts: [] };
}

export function runtimeModelFor(
    cli: string,
    perCli: Record<string, PerCliEntry> = {},
    activeOverrides: Record<string, ActiveOverride> = {},
): string {
    return activeOverrides[cli]?.model || perCli[cli]?.model || '';
}

export function runtimeEffortFor(
    cli: string,
    perCli: Record<string, PerCliEntry> = {},
    activeOverrides: Record<string, ActiveOverride> = {},
): string {
    return activeOverrides[cli]?.effort || perCli[cli]?.effort || '';
}

export function optionList(values: ReadonlyArray<string>, current = ''): Array<{ value: string; label: string }> {
    const unique = new Set<string>();
    if (current) unique.add(current);
    for (const value of values) unique.add(value);
    return Array.from(unique).map((value) => ({ value, label: value }));
}

export function applyCliEnvDefaults(
    cli: string,
    extraEnv: Record<string, string> = {},
    inheritedEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
    if (cli !== 'opencode') return extraEnv;
    if (extraEnv.OPENCODE_ENABLE_EXA !== undefined) return extraEnv;
    if (inheritedEnv.OPENCODE_ENABLE_EXA !== undefined) return extraEnv;
    return {
        ...extraEnv,
        OPENCODE_ENABLE_EXA: 'true',
    };
}

function isTruthyEnv(value: string | undefined): boolean {
    if (!value) return false;
    return value === '1' || value.toLowerCase() === 'true';
}

export function buildSessionResumeKey(
    cli: string,
    env: Record<string, string | undefined>,
): string | null {
    if (cli !== 'opencode') return null;
    return `exa=${isTruthyEnv(env.OPENCODE_ENABLE_EXA) ? '1' : '0'}`;
}

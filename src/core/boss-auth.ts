// Boss-only dispatch token. Generated at server startup, injected into the
// server process env, and propagated to child processes UNLESS they are
// employee spawns. Employee spawns strip this token in `makeCleanEnv`, so
// employee CLIs cannot hit `/api/orchestrate/dispatch` even though they
// share the same localhost privilege as the main agent.

import crypto from 'crypto';

const TOKEN_ENV = 'JAW_BOSS_TOKEN';

let bossToken: string | null = null;

export function initBossToken(): string {
    if (bossToken) return bossToken;
    const fromEnv = process.env[TOKEN_ENV];
    if (fromEnv && fromEnv.length >= 32) {
        bossToken = fromEnv;
    } else {
        bossToken = crypto.randomBytes(32).toString('hex');
        process.env[TOKEN_ENV] = bossToken;
    }
    return bossToken;
}

export function getBossToken(): string {
    return bossToken || '';
}

export function verifyBossToken(candidate: string): boolean {
    if (!bossToken || !candidate) return false;
    if (candidate.length !== bossToken.length) return false;
    try {
        return crypto.timingSafeEqual(
            Buffer.from(candidate, 'utf8'),
            Buffer.from(bossToken, 'utf8'),
        );
    } catch {
        return false;
    }
}

export { TOKEN_ENV as BOSS_TOKEN_ENV };

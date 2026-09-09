import { randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../core/logger.js';
import { logErrorText } from '../messaging/redact.js';

export const SLACK_OPERATOR_TOKEN_FILE = 'slack-operator.token';
/**
 * The secret is never available through the ordinary HTTP auth-token endpoint.
 *
 * The validator is lazy on purpose: the credential file is minted on the FIRST
 * operator call, not at boot. An install that never uses operator mode never
 * creates a secret for a same-account agent to find, which narrows the exposure
 * the threat model in docs/slack-tools.md accepts. A load failure disables
 * operator access for the life of the process, exactly as the old boot-time
 * throw did.
 */
export function initializeSlackOperatorAuth(home: string): (candidate: string) => boolean {
    const path = join(home, SLACK_OPERATOR_TOKEN_FILE);
    let expected: Buffer | null = null;
    let disabled = false;
    const load = (): Buffer | null => {
        if (expected || disabled) return expected;
        try {
            try {
                writeFileSync(path, `jaw-slack-operator-${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            }
            const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            let secret: string;
            try {
                const stat = fstatSync(fd);
                if (!stat.isFile() || stat.size > 128 || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw new Error('slack_operator_token_permissions');
                secret = readFileSync(fd, 'utf8').trim();
            } finally { closeSync(fd); }
            if (!/^jaw-slack-operator-[a-f0-9]{64}$/.test(secret)) throw new Error('slack_operator_token_invalid');
            expected = Buffer.from(secret);
        } catch (error) {
            disabled = true;
            expected = null;
            log.error('[slack:operator] operator credential unavailable; operator access disabled', logErrorText(error));
        }
        return expected;
    };
    return candidate => {
        const secret = load();
        if (!secret) return false;
        const supplied = Buffer.from(candidate);
        return supplied.length === secret.length && timingSafeEqual(supplied, secret);
    };
}

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SLACK_OPERATOR_TOKEN_FILE = 'slack-operator.token';
/** The secret is never available through the ordinary HTTP auth-token endpoint. */
export function initializeSlackOperatorAuth(home: string): (candidate: string) => boolean {
    const path = join(home, SLACK_OPERATOR_TOKEN_FILE);
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
    const expected = Buffer.from(secret);
    return candidate => {
        const supplied = Buffer.from(candidate);
        return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    };
}

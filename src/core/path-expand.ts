import { homedir } from 'node:os';
import { resolve } from 'node:path';

const HOME_PREFIX_RE = /^~(?=\/|\\|$)/;

export function expandHomePath(input: string, homeDir = homedir()): string {
    return input.replace(HOME_PREFIX_RE, homeDir);
}

export function resolveHomePath(input: string, homeDir = homedir()): string {
    return resolve(expandHomePath(input, homeDir));
}

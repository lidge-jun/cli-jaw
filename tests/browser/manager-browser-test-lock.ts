import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCK_DIR = join(tmpdir(), 'cli-jaw-manager-browser-tests.lock');

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withManagerBrowserLock<T>(fn: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + 120_000;
    let acquired = false;
    while (!acquired) {
        try {
            await mkdir(LOCK_DIR);
            acquired = true;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'EEXIST') throw error;
            if (Date.now() > deadline) {
                await rm(LOCK_DIR, { recursive: true, force: true });
            }
            await sleep(100);
        }
    }

    try {
        return await fn();
    } finally {
        await rm(LOCK_DIR, { recursive: true, force: true });
    }
}

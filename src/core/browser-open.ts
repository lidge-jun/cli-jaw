import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

type BrowserOpenCommand = {
    command: string;
    args: string[];
};

type BrowserOpenOptions = {
    logPrefix?: string;
};

export function isWslEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
    if (env["WSL_DISTRO_NAME"] || env["WSL_INTEROP"]) return true;
    if (!existsSync('/proc/version')) return false;

    try {
        return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
    } catch {
        return false;
    }
}

export function browserOpenCommand(url: string, platform = process.platform, env: NodeJS.ProcessEnv = process.env): BrowserOpenCommand {
    if (platform === 'darwin') return { command: 'open', args: [url] };
    if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
    if (platform === 'linux' && isWslEnvironment(env)) {
        return { command: 'cmd.exe', args: ['/c', 'start', '', url] };
    }
    return { command: 'xdg-open', args: [url] };
}

export function openUrlInBrowser(url: string, options: BrowserOpenOptions = {}): void {
    const logPrefix = options.logPrefix || 'browser';
    try {
        const { command, args } = browserOpenCommand(url);
        const opener = spawn(command, args, { detached: true, stdio: 'ignore' });
        opener.on('error', error => {
            console.warn(`[${logPrefix}] failed to open browser automatically: ${error.message}`);
            console.warn(`[${logPrefix}] open manually: ${url}`);
        });
        opener.unref();
    } catch (error) {
        console.warn(`[${logPrefix}] failed to open browser automatically: ${(error as Error).message}`);
        console.warn(`[${logPrefix}] open manually: ${url}`);
    }
}

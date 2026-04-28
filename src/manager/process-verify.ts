import { execFile } from 'node:child_process';
import { Socket } from 'node:net';
import { MANAGED_INSTANCE_HOST } from './constants.js';

const LSOF_TIMEOUT_MS = 750;
const PORT_PROBE_TIMEOUT_MS = 300;
const PORT_FREE_POLL_INTERVAL_MS = 100;

export type ProcessVerifyImpl = {
    isPidAlive: (pid: number) => boolean;
    resolveListeningPid: (port: number) => Promise<number | null>;
    killPid: (pid: number, signal: NodeJS.Signals) => void;
    isPortOccupied: (port: number) => Promise<boolean>;
};

export function isPidAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code === 'EPERM';
    }
}

export function killPid(pid: number, signal: NodeJS.Signals): void {
    process.kill(pid, signal);
}

export async function resolveListeningPid(port: number): Promise<number | null> {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    return await new Promise<number | null>((resolve) => {
        execFile(
            'lsof',
            ['-nP', '-a', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'],
            { timeout: LSOF_TIMEOUT_MS },
            (err, stdout) => {
                if (err) return resolve(null);
                const pids = String(stdout)
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(line => /^p\d+$/.test(line))
                    .map(line => Number(line.slice(1)));
                if (pids.length !== 1) return resolve(null);
                resolve(pids[0]!);
            },
        );
    });
}

export async function isPortOccupied(port: number): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
        const socket = new Socket();
        let settled = false;
        const finish = (occupied: boolean): void => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(occupied);
        };
        socket.setTimeout(PORT_PROBE_TIMEOUT_MS);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
        socket.connect(port, MANAGED_INSTANCE_HOST);
    });
}

export async function waitForPortFree(
    port: number,
    timeoutMs: number,
    impl: Pick<ProcessVerifyImpl, 'isPortOccupied'> = { isPortOccupied },
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!(await impl.isPortOccupied(port))) return true;
        await new Promise(r => setTimeout(r, PORT_FREE_POLL_INTERVAL_MS));
    }
    return !(await impl.isPortOccupied(port));
}

export const defaultProcessVerify: ProcessVerifyImpl = {
    isPidAlive,
    resolveListeningPid,
    killPid,
    isPortOccupied,
};

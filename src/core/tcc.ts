/**
 * macOS TCC 진단 유틸리티 (read-only).
 * TCC DB는 SIP 보호 대상 — 읽기만 가능.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TCC_USER_DB = join(homedir(), 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db');

export interface TccEntry {
    client: string;
    clientType: number;
    authValue: number;      // 0=denied, 1=unknown, 2=allowed, 3=prompt
    authReason: number;
    service: string;
}

export function readTccAppleEventsGrants(): TccEntry[] {
    if (process.platform !== 'darwin' || !existsSync(TCC_USER_DB)) return [];
    try {
        const out = execFileSync('sqlite3', [
            TCC_USER_DB,
            "SELECT client, client_type, auth_value, auth_reason, service FROM access WHERE service='kTCCServiceAppleEvents';",
        ], { encoding: 'utf8', stdio: 'pipe', timeout: 5000 });
        return out.trim().split('\n').filter(Boolean).map(line => {
            const [client, clientType, authValue, authReason, service] = line.split('|');
            return {
                client: client ?? '',
                clientType: Number(clientType),
                authValue: Number(authValue),
                authReason: Number(authReason),
                service: service ?? '',
            };
        });
    } catch {
        return [];
    }
}

export function getLaunchdProcessType(label: string): string | null {
    if (process.platform !== 'darwin') return null;
    const uid = typeof process.getuid === 'function' ? process.getuid() : Number(process.env["UID"] || 0);
    try {
        const out = execFileSync('launchctl', ['print', `gui/${uid}/${label}`], {
            encoding: 'utf8', stdio: 'pipe', timeout: 5000,
        });
        const match = out.match(/process type\s*=\s*(\w+)/i);
        return match ? match[1]! : null;
    } catch {
        return null;
    }
}


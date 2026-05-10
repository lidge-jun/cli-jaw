import { createHash, randomUUID } from 'node:crypto';
import type { JawCeoConfirmationRecord } from './types.js';

export function hashConfirmationArgs(args: unknown): string {
    return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

export function createConfirmationRecord(args: {
    action: string;
    argsHash: string;
    targetPort?: number | undefined;
    sessionId: string;
    now?: Date | undefined;
    expiresInMs?: number | undefined;
}): JawCeoConfirmationRecord {
    const now = args.now ?? new Date();
    const expiresInMs = Math.max(1_000, Math.min(args.expiresInMs ?? 120_000, 10 * 60_000));
    return {
        id: `conf_${randomUUID()}`,
        action: args.action,
        argsHash: args.argsHash,
        ...(args.targetPort !== undefined ? { targetPort: args.targetPort } : {}),
        sessionId: args.sessionId,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + expiresInMs).toISOString(),
    };
}

export function validateConfirmationRecord(args: {
    record: JawCeoConfirmationRecord | null;
    action: string;
    argsHash: string;
    targetPort?: number | undefined;
    sessionId: string;
    now?: Date | undefined;
}): { ok: true } | { ok: false; code: string; message: string } {
    if (!args.record) return { ok: false, code: 'confirmation_not_found', message: 'confirmation token was not found' };
    if (args.record.action !== args.action) return { ok: false, code: 'confirmation_action_mismatch', message: 'confirmation action does not match' };
    if (args.record.argsHash !== args.argsHash) return { ok: false, code: 'confirmation_args_mismatch', message: 'confirmation args do not match' };
    if (args.targetPort !== undefined && args.record.targetPort !== args.targetPort) {
        return { ok: false, code: 'confirmation_port_mismatch', message: 'confirmation target port does not match' };
    }
    if (args.record.sessionId !== args.sessionId) return { ok: false, code: 'confirmation_session_mismatch', message: 'confirmation session does not match' };
    if (args.record.consumedAt) return { ok: false, code: 'confirmation_consumed', message: 'confirmation token has already been consumed' };
    if (args.record.cancelledAt) return { ok: false, code: 'confirmation_cancelled', message: 'confirmation token has been cancelled' };
    if (Date.parse(args.record.expiresAt) <= (args.now ?? new Date()).getTime()) {
        return { ok: false, code: 'confirmation_expired', message: 'confirmation token has expired' };
    }
    return { ok: true };
}

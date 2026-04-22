import { settings } from '../core/config.js';
import { updateSession, upsertSessionBucket } from '../core/db.js';
import { resolveSessionBucket } from './args.js';

export type SessionPersistenceInput = {
    ownerGeneration: number;
    forceNew?: boolean;
    employeeSessionId?: string | null;
    sessionId?: string | null;
    isFallback?: boolean;
    code?: number | null;
    wasKilled?: boolean;
    cli: string;
    model: string;
    resumeKey?: string | null;
    effort: string;
    permissions?: string;
    workingDir?: string;
};

let sessionOwnershipGeneration = 0;

export function getSessionOwnershipGeneration(): number {
    return sessionOwnershipGeneration;
}

export function bumpSessionOwnershipGeneration(): number {
    sessionOwnershipGeneration += 1;
    return sessionOwnershipGeneration;
}

export function resetSessionOwnershipGenerationForTest(): void {
    sessionOwnershipGeneration = 0;
}

export function isCurrentSessionOwner(ownerGeneration: number): boolean {
    return ownerGeneration === sessionOwnershipGeneration;
}

export function shouldPersistMainSession(input: SessionPersistenceInput): boolean {
    if (input.forceNew || input.employeeSessionId || !input.sessionId || input.isFallback) return false;
    // User-initiated kill (SIGTERM/SIGKILL) yields exit codes like 143/137/1 depending on
    // the CLI's signal handler. Allow persistence when wasKilled=true so resume works for
    // CLIs (claude, copilot) that don't translate SIGTERM to exit 0.
    if (
        input.code !== undefined && input.code !== null && input.code !== 0
        && !input.wasKilled
    ) return false;
    return isCurrentSessionOwner(input.ownerGeneration);
}

export function persistMainSession(input: SessionPersistenceInput): boolean {
    if (!shouldPersistMainSession(input)) return false;
    updateSession.run(
        input.cli,
        input.sessionId,
        input.model,
        input.permissions || settings.permissions || 'auto',
        input.workingDir || settings.workingDir || '~',
        input.effort,
    );
    // Mirror into per-bucket table so codex-spark keeps a session independent from
    // plain codex (gpt-5.4 etc.) — avoids 'thread/resume failed: no rollout found'
    // on cross-model toggles.
    const bucket = resolveSessionBucket(input.cli, input.model);
    if (bucket && input.sessionId) {
        upsertSessionBucket.run(bucket, input.sessionId, input.model, input.resumeKey || null);
    }
    return true;
}

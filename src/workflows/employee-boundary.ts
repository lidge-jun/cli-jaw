// Shared assertions for authorized dispatch and employee boundaries.
// Does NOT import provider SDKs.

import type { OrcStateName } from '../orchestrator/state-machine.js';
import { hasImplementationDelegation } from './handoff.js';

export function assertAuthorizedDispatcher(authorized: boolean): void {
    if (!authorized) {
        throw new Error('Only an authorized dispatcher can dispatch jaw employees');
    }
}

/** @deprecated Use assertAuthorizedDispatcher. Kept for existing callers. */
export function assertBossOnlyDispatch(isBoss: boolean): void {
    assertAuthorizedDispatcher(isBoss);
}

export function assertNoImplementationDelegation(phase: OrcStateName, taskBody: string, allowWrite = false): void {
    if (phase === 'B' && !allowWrite && hasImplementationDelegation(taskBody)) {
        throw new Error('B-phase employees are read-only verifiers; implementation delegation is forbidden. Use --mutable to allow writes.');
    }
}

export function assertReadOnlyAudit(phase: OrcStateName, taskBody: string, allowWrite = false): void {
    if (phase === 'A' && !allowWrite) {
        const lc = taskBody.toLowerCase();
        if (lc.includes('write file') || lc.includes('create file') || lc.includes('modify code')) {
            throw new Error('A-phase audit must be read-only');
        }
    }
}

export function validateDispatchTask(opts: {
    authorized: boolean;
    phase: OrcStateName;
    taskBody: string;
    allowWrite?: boolean;
}): { ok: boolean; error?: string } {
    try {
        assertAuthorizedDispatcher(opts.authorized);
        assertNoImplementationDelegation(opts.phase, opts.taskBody, opts.allowWrite);
        assertReadOnlyAudit(opts.phase, opts.taskBody, opts.allowWrite);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }
}

import type { RuntimeLivenessIdentity } from '../../shared/runtime-contract.js';

type Observer = (identity: Readonly<RuntimeLivenessIdentity>) => void;
const observers = new Set<Observer>();
// Bound the private display snapshot; never truncate identity into a different owner.
const MAX_IDENTITY_FIELD_LENGTH = 1024;

export function subscribeRuntimeLiveness(observer: Observer): () => void {
    observers.add(observer);
    return () => { observers.delete(observer); };
}

export function notifyRuntimeLiveness(identity: RuntimeLivenessIdentity): void {
    const { runId, sessionId, scope, origin, requestId } = identity;
    if (![runId, sessionId, scope, origin, requestId].every(value =>
        typeof value === 'string' && value.length <= MAX_IDENTITY_FIELD_LENGTH
        && value.trim().length > 0)) return;
    // Copy only the existing identity fields, never model I/O or extra properties.
    const captured = Object.freeze({ runId, sessionId, scope, origin,
        ...(requestId !== undefined ? { requestId } : {}),
    });
    for (const observer of [...observers]) {
        try { observer(captured); } catch { /* display observers cannot fail model I/O */ }
    }
}

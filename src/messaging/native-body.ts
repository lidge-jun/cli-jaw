// ─── Native runtime terminal tags ────────────────────
// A producer stamps `runtimeFinality` + `runtimeStatus` on a turn that ran
// through a native runtime adapter. Four places were asking the same question
// with the same hand-copied boolean: the three chat bots and the orchestrator's
// collector. #784d6162b spread the delivery half of that rule across the bots,
// so every change to one common delivery rule cost three identical edits.
//
// The two QUESTIONS are kept apart on purpose. `hasNativeRuntimeTags` is the
// neutral observation — these tags are present, so this payload came from a
// native runtime terminal. `requiresNativeBodyDelivery` is a DELIVERY policy
// that currently happens to be the same test. Collect asks the first one: it
// uses the answer to ignore a foreign native terminal, latch `nativeSeen` and
// pick its terminal text. If a later delivery tighten (non-empty text, an
// origin match, a request id) were folded into a single shared function, it
// would silently change collector matching and timeout diagnostics too.

/** True when this broadcast payload carries native runtime terminal tags. */
export function hasNativeRuntimeTags(data: Record<string, unknown>): boolean {
    return (data['runtimeFinality'] === 'present' || data['runtimeFinality'] === 'absent')
        && (data['runtimeStatus'] === 'done' || data['runtimeStatus'] === 'error' || data['runtimeStatus'] === 'stopped');
}

/**
 * True when the body for this payload must be delivered through the native
 * receipt path rather than the legacy best-effort one.
 *
 * Separate from `hasNativeRuntimeTags` so the delivery rule can gain conditions
 * without moving the collector's listener semantics with it.
 */
export function requiresNativeBodyDelivery(data: Record<string, unknown>): boolean {
    return hasNativeRuntimeTags(data);
}

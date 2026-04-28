// Phase 2 — expand a flat dotted-path bundle into a nested patch object
// suitable for `PUT /api/settings`.
//
// Example:
//   expandPatch({ "perCli.codex.model": "gpt-5", "tui.themeSeed": "x" })
//     → { perCli: { codex: { model: "gpt-5" } }, tui: { themeSeed: "x" } }
//
// A key with no dots is preserved at the top level. Array values are placed
// as-is — paths never index inside arrays in our settings shape.

export function expandPatch(bundle: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(bundle)) {
        if (!key.includes('.')) {
            out[key] = value;
            continue;
        }
        const segments = key.split('.');
        let cursor: Record<string, unknown> = out;
        for (let i = 0; i < segments.length - 1; i += 1) {
            const seg = segments[i] as string;
            const existing = cursor[seg];
            if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
                cursor = existing as Record<string, unknown>;
            } else {
                const next: Record<string, unknown> = {};
                cursor[seg] = next;
                cursor = next;
            }
        }
        cursor[segments[segments.length - 1] as string] = value;
    }
    return out;
}

export function getByPath(source: unknown, path: string): unknown {
    if (!path) return source;
    const segments = path.split('.');
    let cursor: unknown = source;
    for (const seg of segments) {
        if (cursor === null || cursor === undefined) return undefined;
        if (typeof cursor !== 'object') return undefined;
        cursor = (cursor as Record<string, unknown>)[seg];
    }
    return cursor;
}

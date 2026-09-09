/**
 * Cursor spells the same model differently on its two transports, so a working
 * print configuration cannot start a native session (#657).
 *
 *   `cursor-agent models` (print `--model`)  claude-4.6-opus-high
 *   ACP `session/new` advertised id           claude-opus-4-6
 *
 * The ACP namespace is the constraint that makes translation tractable: every
 * advertised model id is a bare base. A rung is never part of an id there, it is
 * a separate `effort` select, and Cursor's account prefix for Grok is absent too.
 * Observed on cursor-agent 2026.09.08-6caf4ff, whose 38 advertised ids include
 * `claude-opus-4-6`, `gpt-5.4-mini`, `gpt-5.3-codex`, `grok-4.6` and `default`,
 * with effort offering low/medium/high/max.
 *
 * An earlier attempt translated by comparing alphanumeric segments as an
 * unordered bag, and review rejected it: `gpt-5.4-mini-high` and
 * `gpt-5.4-mini-low` collapse onto one bag, and `max` is a product name in
 * `gpt-5.1-codex-max` rather than a rung, so a unique survivor can be a
 * different model. Every rule here is instead an exact, reversible rewrite, and
 * a candidate is used only when the advertised set actually contains it, so a
 * rule that does not apply can only fall through to the existing failure.
 *
 * This is Cursor policy and deliberately lives outside the shared ACP helper,
 * which takes it as an opaque hook.
 */
import { CURSOR_REGISTRY_MODELS } from './cursor-runtime.js';

/** Cursor's picker names Auto `auto`; ACP advertises it as `default`. */
const PRINT_AUTO = 'auto';
const ACP_AUTO = 'default';

/**
 * Effort spellings a print wire id can carry, mapped to the effort vocabulary
 * the settings field uses. This mirrors the suffix table in
 * cursor-model-inventory.ts, but every match matters here rather than only the
 * longest: `gpt-5.5-extra-high` peels to `gpt-5.5` under `extra-high` and to
 * `gpt-5.5-extra` under `high`, and those are two different products.
 */
const SUFFIX_EFFORT: ReadonlyArray<readonly [string, string]> = [
    ['extra-high-fast', 'xhigh-fast'], ['extra-high', 'xhigh'],
    ['xhigh-fast', 'xhigh-fast'], ['xhigh', 'xhigh'],
    ['medium-fast', 'medium-fast'], ['none-fast', 'none-fast'], ['high-fast', 'high-fast'],
    ['low-fast', 'low-fast'], ['max-fast', 'max-fast'],
    ['medium', 'medium'], ['none', 'none'], ['high', 'high'], ['low', 'low'], ['max', 'max'],
    ['fast', 'medium-fast'],
];

/**
 * Cursor's product vocabulary, which is the picker's list rather than the wire
 * ids. A rung may be peeled only when what remains is one of these, because a
 * suffix that looks like a rung is sometimes part of a product name:
 * `gpt-5.1-codex-max` and `claude-4.5-opus-high` are whole products, and
 * `gpt-5.5-extra` is a distinct model whose only wire id is `gpt-5.5-extra-high`.
 * Accepting whichever leftover happened to be advertised is exactly how a
 * translation binds the wrong model.
 */
const PRODUCTS: ReadonlySet<string> = new Set<string>(CURSOR_REGISTRY_MODELS);

/** Cursor names its Grok routing with an account prefix that ACP does not use. */
function withoutAccountPrefix(id: string): string {
    return id.startsWith('cursor-') ? id.slice('cursor-'.length) : id;
}

/**
 * The product a stored value names, plus the rung it encodes.
 *
 * A value that is already a product name is never peeled. Otherwise every rung
 * spelling is tried and the longest surviving product wins, so a shorter
 * relative can never be selected while a longer one exists.
 */
function product(value: string): { base: string; effort?: string } | undefined {
    if (PRODUCTS.has(value)) return { base: withoutAccountPrefix(value) };
    let best: { base: string; effort: string } | undefined;
    for (const [suffix, effort] of SUFFIX_EFFORT) {
        const tail = `-${suffix}`;
        if (!value.endsWith(tail) || value.length <= tail.length) continue;
        const candidate = withoutAccountPrefix(value.slice(0, -tail.length));
        if (!PRODUCTS.has(candidate)) continue;
        if (!best || candidate.length > best.base.length) best = { base: candidate, effort };
    }
    return best;
}

/**
 * Cursor's older Claude ids put the version before the family. ACP uses the
 * vendor order with a dotted minor spelled as a segment, and both spellings are
 * live in this tree: `claude-4.6-opus` sits beside `claude-opus-4-8` in
 * CURSOR_MODEL_IDS. The rewrite is a bijection on this shape, so it cannot
 * produce the id of a different model.
 */
const VERSION_FIRST_CLAUDE = /^claude-(\d+)(?:\.(\d+))?-([a-z]+)$/;

function vendorOrderClaude(id: string): string | undefined {
    const match = VERSION_FIRST_CLAUDE.exec(id);
    if (!match) return undefined;
    const [, major, minor, family] = match;
    return minor === undefined ? `claude-${family}-${major}` : `claude-${family}-${major}-${minor}`;
}

/**
 * Translate a stored Cursor model value into the ACP namespace.
 *
 * Returns undefined when no rule produces an advertised id, which leaves the
 * caller's existing exact-match failure and its diagnostics untouched.
 */
export function cursorAcpModel(requested: string, advertised: ReadonlyArray<string>,
    configuredEffort?: string | null): string | undefined {
    const value = requested.trim();
    if (!value) return undefined;
    const available = new Set(advertised);
    // An advertised value is already correct; never rewrite what the provider accepts.
    if (available.has(value)) return undefined;
    const candidates: Array<string | undefined> = [];
    if (value === PRINT_AUTO) candidates.push(ACP_AUTO);
    candidates.push(vendorOrderClaude(value));
    const named = product(value);
    if (named && named.base !== value) {
        // A peeled rung is only dropped when the settings effort already says the
        // same thing. ACP would otherwise start the model at whatever thought
        // level the session defaults to, which is a quieter wrong answer than the
        // failure this replaces.
        const rungAgrees = named.effort === undefined
            || named.effort === (configuredEffort ?? '').trim().toLowerCase();
        if (rungAgrees) {
            candidates.push(named.base);
            candidates.push(vendorOrderClaude(named.base));
        }
    }
    return candidates.find((candidate): candidate is string => candidate !== undefined && available.has(candidate));
}

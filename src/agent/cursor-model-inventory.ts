/**
 * Live Cursor model inventory, read from `cursor-agent --list-models`.
 *
 * Cursor keeps two lists in `cursor-runtime.ts`: the wire ids the account accepts
 * (effort encoded in the id, since the CLI has no `--effort`) and the base models
 * the UI offers. Their agreement IS the correctness property — #394 was that
 * agreement breaking, where `grok-4.6` + `high` produced an id the account does
 * not have and the resolver silently degraded to the bare base.
 *
 * The CLI prints exactly the first list, so this module takes it as the
 * observation and DERIVES the second from it rather than maintaining both.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectCli } from '../core/cli-detection.js';
import { CURSOR_EFFORT_CHOICES } from './cursor-runtime.js';

const execFileAsync = promisify(execFile);

export interface CursorModelInventory {
    /** Wire ids exactly as the account names them, effort suffix included. */
    modelIds: string[];
    /** Base models for the picker, derived by stripping known effort suffixes. */
    baseModels: string[];
    /** Effort rungs observed per base model, in canonical ladder order. */
    effortsByModel: Record<string, string[]>;
    source: string;
}

/**
 * Suffix spellings the account uses, longest first so `extra-high-fast` is matched
 * before `high-fast` would strip the wrong half of it.
 *
 * The mapping is the inverse of `CURSOR_EFFORT_SUFFIX` in cursor-runtime.ts; the
 * only entry that is not an identity is Cursor spelling xhigh as `extra-high`.
 */
const SUFFIX_TO_EFFORT: Array<[string, string]> = [
    ['extra-high-fast', 'xhigh-fast'],
    ['extra-high', 'xhigh'],
    ['medium-fast', 'medium-fast'],
    ['none-fast', 'none-fast'],
    ['high-fast', 'high-fast'],
    ['xhigh-fast', 'xhigh-fast'],
    ['low-fast', 'low-fast'],
    ['max-fast', 'max-fast'],
    ['medium', 'medium'],
    ['xhigh', 'xhigh'],
    ['none', 'none'],
    ['high', 'high'],
    ['low', 'low'],
    ['max', 'max'],
    // A bare `-fast` carries no rung of its own. Cursor uses it for the id whose
    // rung is implicit — `gpt-5.3-codex-fast` is the fast form of
    // `gpt-5.3-codex`, not a base model in its own right — so it maps onto the
    // same medium-fast the resolver already emits for that case.
    ['fast', 'medium-fast'],
];

const EFFORT_ORDER = new Map(CURSOR_EFFORT_CHOICES.map((effort, index) => [effort as string, index]));

/**
 * Cursor names its own Grok routing with a `cursor-` prefix, but the picker's
 * vocabulary is unprefixed and `resolveCursorModelVariant` re-applies the prefix
 * when building the wire id. Leaving it on a derived base would reproduce #394 in
 * the opposite direction: `cursor-cursor-grok-4.6-high`.
 */
function stripAccountPrefix(id: string): string {
    return id.startsWith('cursor-') ? id.slice('cursor-'.length) : id;
}

/** Split a wire id into its base model and effort rung, if it carries one. */
export function splitCursorModelId(id: string): { base: string; effort?: string } {
    const value = id.trim();
    if (!value) return { base: '' };
    for (const [suffix, effort] of SUFFIX_TO_EFFORT) {
        const tail = '-' + suffix;
        if (value.endsWith(tail) && value.length > tail.length) {
            return { base: stripAccountPrefix(value.slice(0, -tail.length)), effort };
        }
    }
    return { base: stripAccountPrefix(value) };
}

/**
 * Parse `cursor-agent --list-models` output.
 *
 * Each model is one `<id> - <label>` line. The header, the trailing usage tip and
 * blank lines carry no dash-separated id and are skipped by the shape check rather
 * than by matching their exact text, so a wording change does not break parsing.
 */
export function parseCursorModelList(stdout: string): CursorModelInventory | null {
    const modelIds: string[] = [];
    const seenIds = new Set<string>();
    for (const rawLine of stdout.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('Tip:')) continue;
        const match = /^([A-Za-z0-9][A-Za-z0-9._-]*) - \S/.exec(line);
        if (!match) continue;
        const id = match[1]!;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        modelIds.push(id);
    }
    if (modelIds.length === 0) return null;

    const baseModels: string[] = [];
    const seenBases = new Set<string>();
    const effortSets = new Map<string, Set<string>>();
    for (const id of modelIds) {
        const { base, effort } = splitCursorModelId(id);
        if (!base) continue;
        if (!seenBases.has(base)) {
            seenBases.add(base);
            baseModels.push(base);
        }
        if (!effort) continue;
        const set = effortSets.get(base) ?? new Set<string>();
        set.add(effort);
        effortSets.set(base, set);
    }

    const effortsByModel: Record<string, string[]> = {};
    for (const [base, efforts] of effortSets) {
        effortsByModel[base] = [...efforts].sort(
            (a, b) => (EFFORT_ORDER.get(a) ?? 99) - (EFFORT_ORDER.get(b) ?? 99),
        );
    }

    return {
        modelIds, baseModels, effortsByModel,
        source: 'cursor-agent --list-models',
    };
}

/**
 * Run the CLI and parse its inventory. Any failure answers null so the caller
 * keeps the static list; discovery never empties the picker.
 */
export async function fetchCursorModelInventory(binary?: string): Promise<CursorModelInventory | null> {
    const resolvedBinary = binary || detectCli('cursor').path;
    if (!resolvedBinary) return null;
    try {
        const { stdout } = await execFileAsync(resolvedBinary, ['--list-models'], {
            encoding: 'utf8',
            timeout: 15000,
            env: { ...process.env, NO_COLOR: '1' },
        });
        return parseCursorModelList(stdout);
    } catch {
        return null;
    }
}

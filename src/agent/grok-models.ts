/**
 * Live Grok model inventory, read from `grok models`.
 *
 * The registry carried two ids by hand. The CLI lists what the signed-in account
 * actually serves, which includes opencodex-routed `ocx-*` entries that no static
 * list could have predicted.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectCli } from '../core/cli-detection.js';

const execFileAsync = promisify(execFile);

export interface GrokModelInventory {
    models: string[];
    /** The id the CLI marks as its default, when it names one. */
    defaultModel?: string;
    source: string;
}

/**
 * Parse `grok models` output.
 *
 * The listing is human-formatted: a `Default model: <id>` line, then bullets where
 * the default is starred and the rest are dashed.
 *
 *   Default model: grok-4.6
 *   Available models:
 *     * grok-4.6 (default)
 *     - grok-4.5
 *
 * The bullet is the authority for membership; the header line only names which of
 * them is default, and a listing without it still parses.
 */
export function parseGrokModelList(stdout: string): GrokModelInventory | null {
    const models: string[] = [];
    const seen = new Set<string>();
    let starred = '';
    let declaredDefault = '';

    for (const rawLine of stdout.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        const header = /^Default model:\s*(\S+)/i.exec(line);
        if (header) {
            declaredDefault = header[1]!;
            continue;
        }

        const bullet = /^([*-])\s+([A-Za-z0-9][A-Za-z0-9._\/-]*)/.exec(line);
        if (!bullet) continue;
        const id = bullet[2]!;
        if (seen.has(id)) continue;
        seen.add(id);
        models.push(id);
        if (bullet[1] === '*' && !starred) starred = id;
    }

    if (models.length === 0) return null;

    // Prefer the starred row: it is inside the list, so it cannot name a model the
    // account does not serve. The header is the fallback, and only when it does.
    const defaultModel = starred
        || (declaredDefault && seen.has(declaredDefault) ? declaredDefault : '');

    return {
        models,
        ...(defaultModel ? { defaultModel } : {}),
        source: 'grok models',
    };
}

/** Run the CLI and parse its listing. Any failure answers null. */
export async function fetchGrokModelInventory(binary?: string): Promise<GrokModelInventory | null> {
    const resolvedBinary = binary || detectCli('grok').path;
    if (!resolvedBinary) return null;
    try {
        const { stdout } = await execFileAsync(resolvedBinary, ['models'], {
            encoding: 'utf8',
            timeout: 15000,
            env: { ...process.env, NO_COLOR: '1' },
        });
        return parseGrokModelList(stdout);
    } catch {
        return null;
    }
}

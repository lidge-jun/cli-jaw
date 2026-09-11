// The v1 mention-watch ledger has no runtime writer, and that has to stay true.
//
// A v1 row is keyed by job id alone, with no workspace and no user. A job id is
// reusable, so a later watch inheriting that cursor silently skips everything
// below it — missing a mention is the one outcome the feature exists to prevent,
// which is why fb07276b0 moved the ledger to a namespaced v2 key. The v1 tables
// survive only so legacy-mention-watch-quarantine can hold and archive what is
// already in them.
//
// A grep is the right shape of test here: the defect is an IMPORT, and it does
// its damage the moment production code can reach these statements again (#691).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Reachable only from src/core/db.ts and from tests that build an old home. */
const V1_ONLY_SYMBOLS = [
    'legacyMentionWatchV1Fixture',
    // Removed outright: no caller anywhere when #691 landed. Listed so that
    // re-adding one has to be a deliberate edit to this file too.
    'findMentionWatchSeen',
    'insertMentionWatchSeen',
    'pruneMentionWatchSeen',
    'getMentionWatchCursor',
    'upsertMentionWatchCursor',
    'setMentionWatchResumeBefore',
    'getMentionWatchRotation',
    'upsertMentionWatchRotation',
    'clearMentionWatchState',
];

const OWNER = 'src/core/db.ts';

function* sourceFiles(dir: string): Generator<string> {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'dist') continue;
            yield* sourceFiles(full);
        } else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) {
            yield full;
        }
    }
}

function runtimeFiles(): string[] {
    const files = [...sourceFiles(join(projectRoot, 'src')), ...sourceFiles(join(projectRoot, 'bin'))];
    const serverEntry = join(projectRoot, 'server.ts');
    try { if (statSync(serverEntry).isFile()) files.push(serverEntry); } catch { /* absent */ }
    return files.filter(file => relative(projectRoot, file).split('\\').join('/') !== OWNER);
}

test('LEGACY-V1-001: no runtime file reaches the v1 mention-watch statements', () => {
    const offenders: string[] = [];
    for (const file of runtimeFiles()) {
        const source = readFileSync(file, 'utf8');
        for (const symbol of V1_ONLY_SYMBOLS) {
            // Word boundaries keep the v2 names (insertMentionWatchSeenV2 and
            // friends) out of this, which are the statements production SHOULD use.
            if (new RegExp(`\\b${symbol}\\b`).test(source)) {
                offenders.push(`${relative(projectRoot, file)}: ${symbol}`);
            }
        }
    }
    assert.deepEqual(offenders, [], [
        'v1 mention-watch statements must stay inside ' + OWNER + '.',
        'Writing a v1 row re-creates the workspace-less ledger that fb07276b0 removed;',
        'use src/memory/mention-watch-ledger.ts, which requires a WatchNamespace.',
    ].join(' '));
});

test('LEGACY-V1-002: the owner still exposes the quarantine fixture surface', () => {
    // Guards the test above from passing because the symbol was renamed away and
    // the scan now matches nothing at all.
    const owner = readFileSync(join(projectRoot, OWNER), 'utf8');
    assert.match(owner, /export const legacyMentionWatchV1Fixture/);
    assert.match(owner, /export const commitLegacyFreshStart/);
});


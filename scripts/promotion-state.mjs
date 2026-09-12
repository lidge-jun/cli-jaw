#!/usr/bin/env node
/**
 * promotion-state.mjs — decide what promote-to-main.sh is looking at.
 *
 * WHY THIS EXISTS. `promote-to-main.sh` does three things in order: mint the
 * stable bump, force-with-lease `preview` to it, then fast-forward `main`. The
 * middle step is a remote write, and everything after it can still fail — the
 * script waits for CI before touching `main`. When that wait gave up, `preview`
 * was already carrying `X.Y.Z` while `main` sat at its parent, and re-running
 * the script was refused at its own prerelease check, because `X.Y.Z` is not
 * `X.Y.Z-preview.TIMESTAMP`. The only remaining path was hand recovery.
 *
 * Loosening that regex alone would be worse than the bug: the script would walk
 * into `npm version --allow-same-version`, mint a SECOND commit for the same
 * version, and lease-push it over a commit CI had already certified. So the
 * decision is not "is this a prerelease" but "which of four situations is this",
 * and it is a pure function so the contract test can assert behaviour on
 * fixtures instead of grepping the shell script for phrases.
 *
 * States:
 *   prerelease      preview is X.Y.Z-preview.N  -> mint and push, the normal path
 *   already_on_main preview is X.Y.Z and main is the same commit -> nothing to do
 *   resume          preview is X.Y.Z and carries a promotion commit main has not
 *                   taken yet -> skip the bump, run the certification tail only
 *   refuse          anything else -> stop, because we cannot name what happened
 *
 * `resume` is deliberately narrow. It is not "preview looks stable"; it is a
 * fingerprint of a promotion this script itself left behind: main is an ancestor,
 * the parent commit is the matching prerelease, the subject is the one we write,
 * and the diff against that parent touches nothing but the four version
 * manifests. A stable `preview` that fails any clause is `refuse`, not resume,
 * because a tree we cannot identify must never be fast-forwarded onto main.
 */

/** The only files a promotion commit is allowed to change. */
export const VERSION_MANIFESTS = Object.freeze([
    'package.json',
    'package-lock.json',
    'electron/package.json',
    'electron/package-lock.json',
]);

const PRERELEASE_RE = /^(\d+\.\d+\.\d+)-preview\.\d+$/;
const STABLE_RE = /^\d+\.\d+\.\d+$/;

/**
 * @param {{
 *   previewVersion?: string,
 *   previewSha?: string,
 *   mainSha?: string,
 *   mainIsAncestor?: boolean,
 *   parentVersion?: string,
 *   previewSubject?: string,
 *   changedFiles?: string[],
 * }} input
 */
export function classifyPromotionState(input = {}) {
    const previewVersion = String(input.previewVersion ?? '').trim();
    const previewSha = String(input.previewSha ?? '').trim();
    const mainSha = String(input.mainSha ?? '').trim();

    const prerelease = PRERELEASE_RE.exec(previewVersion);
    if (prerelease) {
        return { state: 'prerelease', stableVersion: prerelease[1] };
    }

    if (!STABLE_RE.test(previewVersion)) {
        return {
            state: 'refuse',
            reason: `preview version must match X.Y.Z-preview.TIMESTAMP or a promotable X.Y.Z; got ${previewVersion || '(empty)'}`,
        };
    }

    // Equality first: an already-finished promotion is a normal outcome and must
    // not be reported as a broken state just because the operator ran again.
    if (previewSha.length > 0 && previewSha === mainSha) {
        return { state: 'already_on_main', stableVersion: previewVersion };
    }

    if (input.mainIsAncestor !== true) {
        return {
            state: 'refuse',
            reason: 'origin/main is not an ancestor of origin/preview, so preview was rewritten rather than promoted',
        };
    }

    const expectedSubject = `chore: promote v${previewVersion}`;
    if (String(input.previewSubject ?? '').trim() !== expectedSubject) {
        return {
            state: 'refuse',
            reason: `preview head is not a promotion commit: expected subject "${expectedSubject}"`,
        };
    }

    const parentVersion = String(input.parentVersion ?? '').trim();
    const parentPre = PRERELEASE_RE.exec(parentVersion);
    if (!parentPre || parentPre[1] !== previewVersion) {
        return {
            state: 'refuse',
            reason: `preview parent must be the matching prerelease ${previewVersion}-preview.TIMESTAMP; got ${parentVersion || '(empty)'}`,
        };
    }

    const changed = (input.changedFiles ?? []).map((f) => String(f).replace(/\\/g, '/').trim()).filter(Boolean);
    if (changed.length === 0) {
        return { state: 'refuse', reason: 'promotion commit changed nothing, so it is not the bump this script writes' };
    }
    const stray = changed.filter((f) => !VERSION_MANIFESTS.includes(f));
    if (stray.length > 0) {
        return {
            state: 'refuse',
            reason: `promotion commit touches more than the version manifests: ${stray.join(', ')}`,
        };
    }

    return { state: 'resume', stableVersion: previewVersion };
}

// CLI: JSON on stdin, one line out as "<state> <stableVersion> <reason...>".
// The shell reads field one and ignores the rest unless it needs to print why.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    let parsed;
    try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch (err) {
        process.stdout.write(`refuse - could not parse promotion state input: ${err.message}\n`);
        process.exit(0);
    }
    const result = classifyPromotionState(parsed);
    process.stdout.write(`${result.state} ${result.stableVersion ?? '-'} ${result.reason ?? ''}\n`.replace(/\s+$/, '') + '\n');
}

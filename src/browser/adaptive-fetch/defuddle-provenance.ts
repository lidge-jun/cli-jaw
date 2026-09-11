/**
 * #695: the vendored Defuddle bundle carries no version string of its own, so
 * this module is the only handle on what those 699KB actually are. The bundle
 * does contain a `version:"0.13.01"` — that belongs to Temml, which is bundled
 * inside it, and using it as a Defuddle version would be wrong.
 *
 * Replacing the bundle means changing these values in the same commit, because
 * browser-adaptive-fetch-defuddle-integrity.test.ts refuses to pass otherwise.
 * That is what turns an upgrade into a hash PR rather than an edit to a number
 * in vendor/README.md.
 *
 * Checked against the npm registry and the GitHub release on 2026-09-11.
 */
export const DEFUDDLE_VENDOR = {
    /** Upstream release the bundle was built from. */
    version: '0.18.1',
    /** Upstream tags this release without a "v" prefix. */
    releaseTag: '0.18.1',
    /** Publish date of that release, for anyone reading an advisory later. */
    releasedAt: '2026-04-22',
    /**
     * npm tarball integrity for defuddle@0.18.1. Recorded provenance, not
     * something the test re-fetches; CI does not run npm pack.
     */
    tarballIntegrity: 'sha512-AvFPFOsoDjt5xUOA1QxzafSSzJ5dqEIC63yO72tHYtSjj1DYY/XM0XTPUCsHkm5A2f1X9ulBvoSVFJrd4s2ckA==',
    /**
     * The entry the bundle must be built from. exports["."] is the lite build,
     * which silently ignores `markdown: true` and returns cleaned HTML.
     */
    entry: 'dist/index.full.js',
    /** Byte length of vendor/defuddle.iife.min.js. */
    bytes: 699043,
    /** sha256 of vendor/defuddle.iife.min.js. */
    sha256: '581bdb074e62570834c284031499e3d80ccca966915ab493b3e662e088770dab',
} as const;

/**
 * Names the full entry contributes and the lite entry does not. These are
 * module export names and library property names, which esbuild preserves; a
 * minified local identifier would change on every rebuild and is useless as a
 * marker.
 */
export const FULL_ENTRY_MARKERS = [
    'toMarkdown',
    'createMarkdownContent',
    'turndown',
    'fencedCodeBlock',
    'blankReplacement',
] as const;

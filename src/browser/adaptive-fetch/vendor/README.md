# Vendored third-party bundles

## defuddle.iife.min.js

- Source: [kepano/defuddle](https://github.com/kepano/defuddle) v0.18.1 — MIT License (c) kepano
- Purpose: in-page main-content → Markdown extraction for the browser-escalation
  reader candidate (`browser-defuddle`). Injected into the rendered page; never
  imported by Node code as a module.
- Not an npm dependency by decision (2026-06-10): the prebuilt single-file IIFE
  is committed so `package.json` stays minimal and the bundle ships via the
  cli-jaw dist build (atomic-build.sh copies `vendor/`).

### Rebuild (version upgrade)

```bash
npm pack defuddle@<version> && tar xzf defuddle-<version>.tgz
cd package
npx esbuild dist/index.full.js --bundle --format=iife --global-name=Defuddle \
  --minify --outfile=<repo>/src/browser/adaptive-fetch/vendor/defuddle.iife.min.js
```

Uses the **full** entry (`dist/index.full.js`, ~700KB minified): the
markdown serializer lives only in the full build — the lite `dist/index.js`
silently ignores `markdown: true` and returns cleaned HTML (verified
2026-06-10 against v0.18.1). After rebuilding, update the version in this
file and rerun `npm test` (there is no `test:unit` script).

### Pinned provenance

| | |
| --- | --- |
| Upstream | kepano/defuddle v0.18.1, released 2026-04-22, MIT |
| Entry | `dist/index.full.js` (the package's `exports["./full"]`) |
| Bundle bytes | 699043 |
| Bundle sha256 | `581bdb074e62570834c284031499e3d80ccca966915ab493b3e662e088770dab` |
| npm tarball integrity | `sha512-AvFPFOsoDjt5xUOA1QxzafSSzJ5dqEIC63yO72tHYtSjj1DYY/XM0XTPUCsHkm5A2f1X9ulBvoSVFJrd4s2ckA==` |

These values also live in `../defuddle-provenance.ts` and are enforced by
`tests/unit/browser-adaptive-fetch-defuddle-integrity.test.ts`. Editing the
numbers in this file alone changes nothing: the test compares the real bytes
against the module, and the module against this table.

The bundle itself contains no Defuddle version string. It does contain
`version:"0.13.01"`, which belongs to Temml — bundled inside it — and is not a
Defuddle version.

### Upgrading is a hash PR, not a README edit

1. Rebuild from the **full** entry with the command above.
2. Recompute the byte length and sha256, and put both in
   `../defuddle-provenance.ts` along with the new version, release date and
   npm tarball integrity.
3. Update the table above to the same values.
4. Read the upstream advisories for the version you are leaving and the one you
   are taking. GHSA-5mq8-78gm-pjmq (CVE-2026-30830, XSS in the schema-text
   fallback) affects `<= 0.7.0` only, so the pin above is outside its range.
5. The integrity test fails until steps 1-3 agree with each other. That failure
   is the point of the gate.

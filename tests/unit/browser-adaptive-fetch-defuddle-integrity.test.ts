import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInContext, createContext } from 'node:vm';
import { DEFUDDLE_VENDOR, FULL_ENTRY_MARKERS } from '../../src/browser/adaptive-fetch/defuddle-provenance.js';

// #695: the bundle is 699KB of minified vendor code with no version string in
// it, one unrelated commit behind it, and nothing in the build that looks at
// its contents. These pin what it is, so replacing it has to be a deliberate
// change to defuddle-provenance.ts rather than an edit to a number in README.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const vendorDir = join(root, 'src/browser/adaptive-fetch/vendor');
const bundlePath = join(vendorDir, 'defuddle.iife.min.js');

function bundleBytes(): Buffer {
    return readFileSync(bundlePath);
}

function sha256(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

test('#695-A the vendored bundle matches its recorded size and sha256', () => {
    const bytes = bundleBytes();
    assert.equal(
        bytes.byteLength,
        DEFUDDLE_VENDOR.bytes,
        `vendor bundle is ${bytes.byteLength} bytes, provenance records ${DEFUDDLE_VENDOR.bytes}`,
    );
    const actual = sha256(bytes);
    assert.equal(
        actual,
        DEFUDDLE_VENDOR.sha256,
        `vendor bundle sha256 is ${actual}; update defuddle-provenance.ts and vendor/README.md together`,
    );
});

test('#695-B README records the same upstream version and entry as the provenance module', () => {
    const readme = readFileSync(join(vendorDir, 'README.md'), 'utf8');
    const expected = `v${DEFUDDLE_VENDOR.version}`;
    const mentions = readme.match(/v\d+\.\d+\.\d+/g) ?? [];
    assert.ok(mentions.length > 0, 'vendor/README.md must state the upstream version');
    // Every mention, not just the first: a stale line left above a new one
    // would otherwise pass.
    for (const mention of mentions) {
        assert.equal(mention, expected, `vendor/README.md mentions ${mention} but the pinned version is ${expected}`);
    }
    assert.ok(
        readme.includes(DEFUDDLE_VENDOR.entry),
        `vendor/README.md must name the required entry ${DEFUDDLE_VENDOR.entry}`,
    );
    assert.ok(readme.includes(DEFUDDLE_VENDOR.sha256), 'vendor/README.md must carry the pinned sha256');
});

test('#695-C a lite-entry rebuild fails the gate', () => {
    // The lite entry drops the markdown serializer, so a rebuild against
    // exports["."] loses every one of these names.
    const source = bundleBytes().toString('utf8');
    for (const marker of FULL_ENTRY_MARKERS) {
        assert.ok(
            source.includes(marker),
            `"${marker}" is missing — this looks like a lite-entry build, which ignores markdown: true`,
        );
    }
});

test('#695-D the bundle is the esbuild IIFE the extractor expects', () => {
    const source = bundleBytes().toString('utf8');
    assert.ok(
        source.startsWith('var Defuddle='),
        'the extractor injects this and reads globalThis.Defuddle, so it must be the named IIFE build',
    );
});

test('#695-E the pinned bundle evaluates and exposes a Defuddle class', () => {
    // Hash first, in this test rather than relying on #695-A: the runner uses
    // concurrency, so a separate test passing is no guarantee this one is
    // evaluating reviewed bytes.
    const bytes = bundleBytes();
    assert.equal(sha256(bytes), DEFUDDLE_VENDOR.sha256, 'refusing to evaluate a bundle that is not the pinned one');

    // An empty context, so nothing leaks into the test realm. The bundle guards
    // its document access, so it loads without a DOM; parse() would need one
    // and is deliberately not called.
    const context = createContext({});
    const exported = runInContext(`${bytes.toString('utf8')}\n;Defuddle;`, context, { timeout: 20_000 }) as unknown;
    assert.equal(typeof exported, 'function', 'the bundle must expose Defuddle as a constructor');
    const proto = Object.getOwnPropertyNames((exported as { prototype: object }).prototype);
    assert.ok(proto.includes('parse'), 'Defuddle.prototype.parse is what the extractor calls');
    assert.ok(proto.includes('parseAsync'), 'Defuddle.prototype.parseAsync is part of the same surface');
});

test('#695-F the recorded tarball integrity has the shape npm publishes', () => {
    // Format only. Verifying it would mean fetching the tarball, which the
    // unit lane does not do.
    assert.match(DEFUDDLE_VENDOR.tarballIntegrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
    assert.equal(DEFUDDLE_VENDOR.releaseTag.startsWith('v'), false, 'upstream tags without a v prefix');
    assert.match(DEFUDDLE_VENDOR.releasedAt, /^\d{4}-\d{2}-\d{2}$/);
});


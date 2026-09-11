import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLiveSmokeManifest, LIVE_SMOKE_MANIFEST_VERSION } from '../../src/browser/adaptive-fetch/live-smoke-manifest.js';
import { resolvePublicEndpointCandidates } from '../../src/browser/adaptive-fetch/endpoint-resolvers.js';
import { validateFetchUrl } from '../../src/browser/adaptive-fetch/safety.js';

test('live smoke manifest is default-off data with public known URLs only', () => {
    const manifest = getLiveSmokeManifest();
    assert.equal(LIVE_SMOKE_MANIFEST_VERSION, 2);
    assert.ok(manifest.length >= 4);
    for (const entry of manifest) {
        const parsed = validateFetchUrl(entry.url, { allowPrivateNetwork: false });
        assert.equal(parsed.protocol, 'https:');
        assert.ok(entry.id);
        assert.ok(entry.reason);
        assert.ok(entry.expectedLabels.length > 0);
        assert.ok(entry.expectedEvidence.length > 0);
        assert.match(entry.browserMode, /^(auto|never|required)$/);
    }
});

test('live smoke manifest returns defensive copies', () => {
    const first = getLiveSmokeManifest();
    first[0]?.expectedLabels.push('mutated');
    const second = getLiveSmokeManifest();
    assert.ok(!second[0]?.expectedLabels.includes('mutated'));
});

// #694: the manifest called itself a drift check but nothing compared it to the
// resolver, so arxiv, stackexchange and wikipedia carried labels the resolver
// has never produced. These make the manifest answerable to the code.
//
// Labels split in two. The resolver emits per-URL endpoint labels; the
// scheduler and the browser ladder attach their own stage labels, which no
// resolver call will ever return.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGE_LABELS = ['direct-fetch', 'jina-reader', 'browser-render', 'browser-metadata'];

function resolverLabelsFor(url: string): Set<string> {
    return new Set(resolvePublicEndpointCandidates(url).map(candidate => candidate.label));
}

test('#694-A every resolver-derived manifest label is actually produced for that URL', () => {
    for (const entry of getLiveSmokeManifest()) {
        const produced = resolverLabelsFor(entry.url);
        for (const label of entry.expectedLabels) {
            if (STAGE_LABELS.includes(label)) continue;
            assert.ok(
                produced.has(label),
                `${entry.id}: expected label "${label}" is not produced by resolvePublicEndpointCandidates("${entry.url}"); the resolver returned [${[...produced].join(', ') || 'nothing'}]`,
            );
        }
    }
});

test('#694-B a label the resolver does not produce must be a known stage label', () => {
    for (const entry of getLiveSmokeManifest()) {
        const produced = resolverLabelsFor(entry.url);
        for (const label of entry.expectedLabels) {
            assert.ok(
                produced.has(label) || STAGE_LABELS.includes(label),
                `${entry.id}: label "${label}" is neither resolver output nor a known stage label`,
            );
        }
    }
});

test('#694-C the stage-label allowlist is grounded in a real label literal', () => {
    // A bare substring search would pass on a comment, so match the quoted
    // literal the producing module actually writes.
    const sources = [
        readFileSync(join(root, 'src/browser/adaptive-fetch/scheduler.ts'), 'utf8'),
        readFileSync(join(root, 'src/browser/adaptive-fetch/browser-escalation.ts'), 'utf8'),
    ].join('\n');
    for (const label of STAGE_LABELS) {
        assert.ok(
            sources.includes(`'${label}'`),
            `stage label "${label}" is not written by the scheduler or the browser ladder`,
        );
    }
});

test('#694-D every public-endpoint evidence names a label the entry expects', () => {
    const prefix = 'public-endpoint:';
    for (const entry of getLiveSmokeManifest()) {
        for (const evidence of entry.expectedEvidence) {
            if (!evidence.startsWith(prefix)) continue;
            const label = evidence.slice(prefix.length);
            assert.ok(
                entry.expectedLabels.includes(label),
                `${entry.id}: evidence "${evidence}" names a label the entry does not expect`,
            );
        }
    }
});


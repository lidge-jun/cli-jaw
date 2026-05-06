import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildObservationBundle,
    formatObservationBundle,
    OBSERVATION_BUNDLE_SCHEMA_VERSION,
    type ObservationBundleInput,
} from '../../src/browser/web-ai/observation-bundle.js';

const baseInput: ObservationBundleInput = {
    url: 'https://example.com/login',
    title: 'Sign in',
    viewport: { width: 1280, height: 800 },
    dpr: 2,
    snapshotNodes: [
        { ref: '@e1', role: 'heading', name: 'Sign in', depth: 1 },
        { ref: '@e2', role: 'textbox', name: 'Email', depth: 2 },
        { ref: '@e3', role: 'button', name: 'Submit', depth: 2 },
        { ref: '...', role: 'note', name: 'truncated' },
    ],
    boxes: {
        '@e2': { x: 10, y: 20, width: 200, height: 30 },
        '@e3': { x: 10, y: 60, width: 100, height: 32 },
    },
    screenshotPath: '/tmp/x.png',
    textSummary: 'hello world',
    capturedAt: '2026-05-06T13:00:00.000Z',
};

test('observation-bundle: schemaVersion + ref filtering', () => {
    const b = buildObservationBundle(baseInput);
    assert.equal(b.schemaVersion, 'observation-bundle-v1');
    assert.equal(OBSERVATION_BUNDLE_SCHEMA_VERSION, 'observation-bundle-v1');
    assert.deepEqual(b.refs.map((r) => r.ref), ['@e1', '@e2', '@e3']);
});

test('observation-bundle: boxes attached to matching refs only', () => {
    const b = buildObservationBundle(baseInput);
    const map = Object.fromEntries(b.refs.map((r) => [r.ref, r]));
    assert.deepEqual(map['@e2'].box, { x: 10, y: 20, width: 200, height: 30 });
    assert.equal(map['@e1'].box, undefined);
    assert.equal(b.stats.boxCount, 2);
});

test('observation-bundle: text clamp', () => {
    const big = 'x'.repeat(5000);
    const b = buildObservationBundle({ ...baseInput, textSummary: big, maxTextChars: 100 });
    assert.equal(b.textSummary.length, 100);
    assert.ok(b.textSummary.endsWith('...'));
    assert.equal(b.stats.textChars, 100);
});

test('observation-bundle: stats + screenshot path', () => {
    const b = buildObservationBundle(baseInput);
    assert.equal(b.stats.refCount, 3);
    assert.equal(b.stats.hasScreenshot, true);
    assert.equal(b.screenshot, '/tmp/x.png');
});

test('observation-bundle: defaults when fields missing', () => {
    const b = buildObservationBundle({
        url: 'https://x.test/',
        viewport: { width: 800, height: 600 },
        snapshotNodes: [{ ref: '@e1', role: 'button', name: 'Go' }],
    });
    assert.equal(b.screenshot, null);
    assert.equal(b.dpr, 1);
    assert.equal(b.title, '');
    assert.equal(b.stats.boxCount, 0);
});

test('observation-bundle: throws on missing required inputs', () => {
    assert.throws(() => buildObservationBundle({} as never));
    assert.throws(() => buildObservationBundle({ url: 'x' } as never));
});

test('observation-bundle: format output includes schema label + box info', () => {
    const b = buildObservationBundle(baseInput);
    const text = formatObservationBundle(b);
    assert.match(text, /observation-bundle-v1/);
    assert.match(text, /refs=3/);
    assert.match(text, /@e2.*box=10,20,200x30/);
});

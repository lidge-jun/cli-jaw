import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildObserveActions,
    formatObserveActions,
    type WebAiSnapshotLike,
} from '../../src/browser/web-ai/observe-actions.js';

const fixture: WebAiSnapshotLike = {
    snapshotId: 'snap-cli-jaw',
    url: 'https://example.com/login',
    refs: {
        '@e1': { role: 'heading', name: 'Sign in to your account' },
        '@e2': { role: 'textbox', name: 'Email', required: true },
        '@e3': { role: 'textbox', name: 'Password', required: true },
        '@e4': { role: 'checkbox', name: 'Remember me' },
        '@e5': { role: 'button', name: 'Sign in' },
        '@e6': { role: 'link', name: 'Forgot password?' },
        '@e7': { role: 'button', name: 'Delete account' },
        '@e8': { role: 'button', name: 'Disabled action', disabled: true },
        '@e9': { role: 'button', name: 'Upload file' },
        '@e10': { role: 'combobox', name: 'Country' },
    },
};

test('observe-actions: returns candidates ranked desc with snapshotId in args', () => {
    const r = buildObserveActions(fixture, '');
    assert.equal(r.snapshotId, 'snap-cli-jaw');
    assert.ok(r.candidates.length > 0);
    for (const c of r.candidates) assert.equal(c.args.snapshotId, 'snap-cli-jaw');
    const confs = r.candidates.map((c) => c.confidence);
    const sorted = [...confs].sort((a, b) => b - a);
    assert.deepEqual(confs, sorted);
});

test('observe-actions: instruction overlap boosts the matching button', () => {
    const r = buildObserveActions(fixture, 'click sign in');
    assert.equal(r.candidates[0].ref, '@e5');
    assert.equal(r.candidates[0].action, 'click');
    assert.ok(r.candidates[0].signals.some((s) => s.startsWith('instruction-overlap')));
});

test('observe-actions: risk flags for destructive/auth/upload/crossOrigin', () => {
    const r = buildObserveActions(fixture, '', { topN: 20, includeDisabled: true });
    const map = Object.fromEntries(r.candidates.map((c) => [c.ref, c]));
    assert.ok(map['@e3'].riskFlags.includes('requiresAuth'));
    assert.ok(map['@e7'].riskFlags.includes('destructive'));
    assert.ok(map['@e9'].riskFlags.includes('fileUpload'));
    assert.ok(map['@e6'].riskFlags.includes('crossOrigin'));
});

test('observe-actions: role-aware methods + combobox→select', () => {
    const r = buildObserveActions(fixture, '', { topN: 20 });
    const map = Object.fromEntries(r.candidates.map((c) => [c.ref, c]));
    assert.equal(map['@e2'].action, 'type');
    assert.equal(map['@e4'].action, 'check');
    assert.equal(map['@e5'].action, 'click');
    assert.equal(map['@e5'].method, 'browser_click_ref');
    assert.equal(map['@e10'].action, 'select');
});

test('observe-actions: disabled gating', () => {
    const off = buildObserveActions(fixture, '', { topN: 20 });
    assert.equal(off.candidates.some((c) => c.ref === '@e8'), false);
    const on = buildObserveActions(fixture, '', { topN: 20, includeDisabled: true });
    assert.equal(on.candidates.some((c) => c.ref === '@e8'), true);
});

test('observe-actions: formatObserveActions readable + empty handling', () => {
    const r = buildObserveActions(fixture, 'sign in');
    const text = formatObserveActions(r);
    assert.match(text, /observe-actions: \d+ candidate/);
    assert.match(text, /@e\d+\s+conf=/);
    const empty = buildObserveActions({ snapshotId: null, url: null, refs: {} }, 'x');
    assert.deepEqual(empty.candidates, []);
    assert.match(formatObserveActions(empty), /no candidates/);
});

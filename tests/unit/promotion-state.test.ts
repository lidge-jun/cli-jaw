import { strict as assert } from 'node:assert';
import test from 'node:test';

import { classifyPromotionState, VERSION_MANIFESTS } from '../../scripts/promotion-state.mjs';

/**
 * The shape these fixtures describe is not hypothetical. Promoting v2.17.50 left
 * `preview` at the stable bump while `main` stayed at its parent, because the
 * certification wait gave up before the main push. Re-running the script was
 * then refused by its own prerelease check, so the release was finished by hand.
 *
 * These cases assert the classifier can tell that situation apart from the three
 * it must NOT treat as resumable.
 */

const RESUMABLE = {
    previewVersion: '2.17.50',
    previewSha: 'f8a6aac7e649fef1eb3d8eba1ced5c207ec12597',
    mainSha: '112b9e21aa8f2ee61f7d7ee9dfe3de953f5206bc',
    mainIsAncestor: true,
    parentVersion: '2.17.50-preview.20260912112701',
    previewSubject: 'chore: promote v2.17.50',
    changedFiles: [...VERSION_MANIFESTS],
};

test('PROMO-001: a prerelease preview takes the ordinary mint-and-push path', () => {
    const result = classifyPromotionState({ previewVersion: '2.17.51-preview.20260913010203' });
    assert.equal(result.state, 'prerelease');
    assert.equal(result.stableVersion, '2.17.51');
});

test('PROMO-002: a finished promotion reports itself instead of failing', () => {
    const sha = 'f8a6aac7e649fef1eb3d8eba1ced5c207ec12597';
    const result = classifyPromotionState({ previewVersion: '2.17.50', previewSha: sha, mainSha: sha });
    assert.equal(result.state, 'already_on_main');
});

test('PROMO-003: the exact state a timed-out promotion leaves behind is resumable', () => {
    const result = classifyPromotionState(RESUMABLE);
    assert.equal(result.state, 'resume');
    assert.equal(result.stableVersion, '2.17.50');
});

test('PROMO-004: resume needs every clause, not a stable-looking version', () => {
    // Each row removes exactly one clause from a resumable fingerprint. Dropping
    // any of them must refuse, because the thing being fast-forwarded onto main
    // would no longer be a commit this script is known to have written.
    const cases: Array<[string, Record<string, unknown>]> = [
        ['main is not an ancestor, so preview was rewritten', { mainIsAncestor: false }],
        ['the head is not a promotion commit', { previewSubject: 'fix(heartbeat): something else' }],
        ['the parent is not the matching prerelease', { parentVersion: '2.17.49-preview.20260911' }],
        ['the parent is already stable', { parentVersion: '2.17.49' }],
        ['the commit carries source changes', { changedFiles: ['package.json', 'src/memory/heartbeat.ts'] }],
        ['the commit carries a workflow change', { changedFiles: ['.github/workflows/publish.yml'] }],
        ['the commit changed nothing', { changedFiles: [] }],
    ];
    for (const [why, override] of cases) {
        const result = classifyPromotionState({ ...RESUMABLE, ...override });
        assert.equal(result.state, 'refuse', `must refuse when ${why}`);
        assert.ok((result.reason ?? '').length > 0, `refusal must say why when ${why}`);
    }
});

test('PROMO-005: a version that is neither prerelease nor stable is refused', () => {
    for (const previewVersion of ['', '2.17', 'v2.17.50', '2.17.50-rc.1', '2.17.50-preview']) {
        const result = classifyPromotionState({ ...RESUMABLE, previewVersion });
        assert.equal(result.state, 'refuse', `must refuse "${previewVersion}"`);
    }
});

test('PROMO-006: the manifest allowlist is exactly the four release ledger files', () => {
    // Widening this list is how a source change would become resumable, so the
    // list itself is the assertion rather than an implementation detail.
    assert.deepEqual([...VERSION_MANIFESTS].sort(), [
        'electron/package-lock.json',
        'electron/package.json',
        'package-lock.json',
        'package.json',
    ]);
});

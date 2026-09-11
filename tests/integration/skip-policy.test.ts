/**
 * Keeps the skip registry honest (#689).
 *
 * tests/run.mts counts failures and ignores skips, so a file that quietly stops
 * running looks exactly like one that passed. #661 is the precedent: a driver
 * bug reported 2 of 6 tests in a file and a green ci-aggregate hid a real
 * failure. A prose table would rot the same way, so the table is executable:
 * a new skipping file fails this test until someone writes down why, and an
 * entry that no longer matches a real skip fails it until someone removes it.
 *
 * Granularity is per FILE, not per line. Several worktrees edit tests/unit in
 * parallel, and adding a case to an already-registered file should not break
 * anyone. A brand-new skipping file should, and does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKIP_POLICY, findSkippingFiles, type SkipPolicy } from '../helpers/skip-policy.mts';

const POLICIES: SkipPolicy[] = ['ci-required', 'local-skip-allowed', 'opt-in-isolated', 'platform'];

test('SKIP-POLICY-001: every skipping test file states why it skips', () => {
    const listed = new Set(SKIP_POLICY.map(entry => entry.file));
    const unlisted = findSkippingFiles().filter(file => !listed.has(file));
    assert.deepEqual(
        unlisted,
        [],
        'these test files skip without a recorded reason. Add an entry to tests/helpers/skip-policy.mts '
        + 'saying why the skip exists and whether CI is allowed to accept it:\n  ' + unlisted.join('\n  '),
    );
});

test('SKIP-POLICY-002: every recorded entry still matches a real skip', () => {
    const found = new Set(findSkippingFiles());
    const stale = SKIP_POLICY.map(entry => entry.file).filter(file => !found.has(file));
    assert.deepEqual(
        stale,
        [],
        'these entries no longer describe a file that skips. Remove them from tests/helpers/skip-policy.mts '
        + 'rather than leaving the table describing a past state:\n  ' + stale.join('\n  '),
    );
});

test('SKIP-POLICY-003: every entry carries a reason and a known policy', () => {
    const seen = new Set<string>();
    for (const entry of SKIP_POLICY) {
        assert.ok(!seen.has(entry.file), 'duplicate entry for ' + entry.file);
        seen.add(entry.file);
        assert.ok(POLICIES.includes(entry.policy), entry.file + ' has an unknown policy: ' + entry.policy);
        // A reason short enough to be a label is not a reason. The point of the
        // table is that a reader who did not write the skip can judge it.
        assert.ok(entry.why.trim().length >= 40, entry.file + ' needs a real explanation, not a label: ' + entry.why);
    }
});

test('SKIP-POLICY-004: the two files that fail closed under CI still do', () => {
    // These are the anchors of the whole classification. api-smoke has always
    // failed closed; graceful-shutdown is the one #689 was opened about, and if
    // its CI branch is ever removed the table would still claim ci-required
    // while the file green-skips again.
    for (const file of ['tests/integration/api-smoke.test.ts', 'tests/integration/graceful-shutdown.test.ts']) {
        const entry = SKIP_POLICY.find(candidate => candidate.file === file);
        assert.ok(entry, file + ' must be recorded');
        assert.equal(entry.policy, 'ci-required', file + ' is the pattern the table is measured against');
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotDigest, recoverNode } from '../../src/browser/actions.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const actionsSrc = fs.readFileSync(join(root, 'src/browser/actions.ts'), 'utf8');

type N = { ref: string; role: string; name: string; depth: number; occurrence: number };
let counter = 0;
const node = (role: string, name: string, depth = 1): N =>
    ({ ref: `e${++counter}`, role, name, depth, occurrence: 0 });

// A ref is a position in a parse, not a handle on an element. Everything here
// is about what that costs and what can honestly be claimed instead.

test('RI-001: an insertion above a ref changes the digest', () => {
    const before = [node('button', 'A'), node('button', 'B'), node('button', 'C')];
    const after = [node('status', 'Loading'), ...before];
    assert.notEqual(snapshotDigest(before), snapshotDigest(after));
});

test('RI-002: a deletion inside a uniform run changes the digest', () => {
    // The case a per-node tuple cannot see. Ten identical rows, delete one, and
    // every surviving index still carries a byte-identical role+name+occurrence
    // while naming its neighbour. Only the list can tell.
    const rows = (n: number) => Array.from({ length: n }, () => node('link', 'Open'));
    assert.notEqual(snapshotDigest(rows(10)), snapshotDigest(rows(9)));
});

test('RI-003: reordering changes the digest even with the same members', () => {
    const a = [node('button', 'Save'), node('button', 'Cancel')];
    assert.notEqual(snapshotDigest(a), snapshotDigest([...a].reverse()));
});

test('RI-004: depth is part of the fingerprint', () => {
    // A node moving between parents changes what a ref means without changing
    // its role or name.
    assert.notEqual(snapshotDigest([node('button', 'Save', 1)]), snapshotDigest([node('button', 'Save', 3)]));
});

test('RI-005: an unchanged list keeps its digest', () => {
    const list = [node('button', 'Save'), node('link', 'Open'), node('textbox', '')];
    assert.equal(snapshotDigest(list), snapshotDigest(list.map(n => ({ ...n }))));
    assert.equal(snapshotDigest([]), snapshotDigest([]));
});

test('RI-006: the digest does not depend on how the snapshot was requested', () => {
    // `interactive` and `maxNodes` shape what a caller is shown and say nothing
    // about the page. Digesting the shown list made the fingerprint a function
    // of the REQUEST, so a lookup that re-snapshotted with different options
    // compared 40 interactive nodes against 400 unfiltered ones and concluded
    // the page had moved — every time, on a page that had not changed.
    assert.match(actionsSrc, /const unfiltered = nodes;/);
    assert.match(actionsSrc, /digest: snapshotDigest\(unfiltered\)/);
    const capture = actionsSrc.indexOf('const unfiltered = nodes;');
    const filter = actionsSrc.indexOf("if (opts[\"interactive\"])");
    assert.ok(capture < filter, 'the whole parse must be captured before it is filtered');
});

// ─── recovery, which is where a wrong click would come from ─────────────

test('RI-007: a uniquely named node that survived is recovered', () => {
    const was = node('button', 'Publish');
    const before = [node('status', 'Idle'), was];
    const after = [node('status', 'Saving'), node('status', 'Idle'), { ...was, ref: 'e99' }];
    const got = recoverNode(was, before, after);
    assert.notEqual(got, 'absent');
    assert.notEqual(got, 'ambiguous');
    assert.equal((got as N).ref, 'e99');
});

test('RI-008: a node whose twin was removed is NOT recovered', () => {
    // The trap. Two rows each carrying `button "Delete"`; the caller points at
    // the first; the page removes that row. Exactly one Delete now remains, so
    // a uniqueness-in-the-fresh-list rule resolves to it and deletes the OTHER
    // row — the original defect, reproduced inside its own fix, on an operation
    // nobody can undo. Removal is what manufactured the uniqueness.
    const rowA = node('button', 'Delete');
    const rowB = node('button', 'Delete');
    const before = [rowA, rowB];
    const after = [{ ...rowB, ref: 'e77' }];
    assert.equal(recoverNode(rowA, before, after), 'ambiguous');
});

test('RI-009: a node that was never unique is not recovered either', () => {
    const a = node('link', 'Open');
    const before = [a, node('link', 'Open'), node('link', 'Open')];
    const after = [node('link', 'Open'), node('link', 'Open'), node('link', 'Open')];
    assert.equal(recoverNode(a, before, after), 'ambiguous');
});

test('RI-010: a genuinely absent node reports absence, not ambiguity', () => {
    const was = node('button', 'Publish');
    assert.equal(recoverNode(was, [was], [node('button', 'Save')]), 'absent');
});

test('RI-011: an empty name is not identifying', () => {
    // parseAriaYaml folds a name its regex failed to capture into the same
    // bucket as a genuinely unnamed node, so recovering `button ""` to some
    // other `button ""` would be a wrong click justified by a parser artifact.
    const was = node('button', '');
    assert.equal(recoverNode(was, [was], [{ ...node('button', ''), ref: 'e88' }]), 'ambiguous');
});

test('RI-012: depth participates in recovery, as it does in the digest', () => {
    // The key that decides which element to CLICK should not be weaker than
    // the key that decides whether to be suspicious. But a depth change is not
    // absence: a modal wrapping the target, or a section above it expanding,
    // moves it without removing it, and saying "no longer on the page" about
    // an element plainly still there sends the reader somewhere useless.
    const was = node('button', 'Edit', 2);
    const elsewhere = { ...node('button', 'Edit', 5), ref: 'e55' };
    assert.equal(recoverNode(was, [was], [elsewhere]), 'moved');
});

test('RI-012b: a genuinely gone element is still absent, not moved', () => {
    const was = node('button', 'Publish', 2);
    assert.equal(recoverNode(was, [was], [node('button', 'Save', 2)]), 'absent');
});

test('RI-012c: the three failures say different things', () => {
    // "gone", "still here but somewhere else", and "now one of several" send a
    // reader to three different places.
    assert.match(actionsSrc, /which is no longer on the page — re-run snapshot/);
    assert.match(actionsSrc, /still on the page but somewhere else in the tree — re-run snapshot/);
    assert.match(actionsSrc, /is now one of several — re-run snapshot/);
});

test('RI-017: the exported digest does not pretend to be a token', () => {
    // A caller holding a digest would reasonably assume its refs were checked
    // against the snapshot it saw. They were not: the internal basis rotates
    // whenever anything re-snapshots, including a ref lookup itself. Binding
    // the check to the caller's own observation needs the snapshotId
    // round-trip, which is its own unit.
    assert.match(actionsSrc, /digestIsDiagnostic: true/);
    assert.match(actionsSrc, /it is not a token/);
});

// ─── the lookup path ────────────────────────────────────────────────────

test('RI-013: the comparison basis is captured before the re-snapshot', () => {
    // `snapshot()` assigns `latestSnapshot` before it returns, so reading the
    // module state after the call compares the fresh parse against itself — a
    // check that passes unconditionally and looks like it is working. No test
    // over a pure function can see this, which is why it is asserted here.
    const fn = actionsSrc.slice(
        actionsSrc.indexOf('async function refToLocator'),
        actionsSrc.indexOf('What would receive a click at a viewport point'),
    );
    const captureAt = fn.indexOf('const previousState = latestSnapshot;');
    const snapshotAt = fn.indexOf('await snapshot(port)');
    assert.ok(captureAt > 0 && snapshotAt > 0);
    assert.ok(captureAt < snapshotAt, 'the capture must come first');
});

test('RI-014: a basis from another page is a refusal, not a fail-open', () => {
    // An absent basis says nothing about the page; a basis from a different URL
    // is affirmative evidence that every positional ref is meaningless. The
    // precedent agrees — assertFreshObservationBundle throws on a known URL
    // mismatch and fails open only when a side is absent.
    const fn = actionsSrc.slice(
        actionsSrc.indexOf('async function refToLocator'),
        actionsSrc.indexOf('What would receive a click at a viewport point'),
    );
    assert.match(fn, /if \(!previousState\) \{/);
    assert.match(fn, /and the page is now .* — re-run snapshot/);
    assert.doesNotMatch(fn, /!previousState \|\| previousState\.url !== page\.url\(\)/);
});

test('RI-015: there is no longer a path to a locator with no freshness check', () => {
    // The cache branch resolved straight out of the stored parse when tab, URL
    // and state version matched — none of which can see a DOM mutation, while
    // `.nth(occurrence)` indexes the live DOM at click time.
    const fn = actionsSrc.slice(
        actionsSrc.indexOf('async function refToLocator'),
        actionsSrc.indexOf('What would receive a click at a viewport point'),
    );
    assert.doesNotMatch(fn, /cacheUsable/);
    assert.equal((fn.match(/await snapshot\(port\)/g) || []).length, 1, 'exactly one parse is read');
});

test('RI-016: the snapshot carries its digest to callers', () => {
    assert.match(actionsSrc, /snapshotId: latestSnapshot\.snapshotId, digest: latestSnapshot\.digest/);
});

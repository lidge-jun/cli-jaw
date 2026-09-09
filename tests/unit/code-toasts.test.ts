import test from 'node:test';
import assert from 'node:assert/strict';
import { CODE_TOAST_DEFAULT_MS, applyCodeNotice, codeToastAutoDismisses,
    dismissCodeToast, pushCodeToast, type CodeToast } from '../../public/manager/src/code/code-toasts.ts';

const notice = (id: string, message = id) => ({ id, message, variant: 'warning' as const, durationMs: CODE_TOAST_DEFAULT_MS });

test('a repeated notice replaces itself instead of stacking', () => {
    let list = pushCodeToast([], notice('policy', 'Auto (YOLO)'));
    list = pushCodeToast(list, notice('policy', 'Auto (YOLO) again'));
    assert.equal(list.length, 1);
    assert.equal(list[0]?.message, 'Auto (YOLO) again');
    // The revision is what restarts the timer for a notice already on screen.
    assert.equal(list[0]?.revision, 2);
});

test('a policy notice is raised while the policy holds and retired when it changes', () => {
    // Derived from current state, not from a transition: the footer remounts
    // when a draft becomes a real session, and a transition detector reads that
    // remount as "nothing changed" -- which deleted the warning at the exact
    // moment the session started acting on it.
    let list = applyCodeNotice([], { id: 'code:permission-mode', variant: 'warning',
        message: 'Auto (YOLO): actions may run without approval.', durationMs: Number.POSITIVE_INFINITY });
    assert.equal(list.length, 1);
    assert.equal(codeToastAutoDismisses(list[0]!), false, 'a standing policy warning does not expire on a timer');
    // Re-raising it on a remount is idempotent, so the warning survives the
    // draft-to-session transition instead of being announced twice.
    list = applyCodeNotice(list, { id: 'code:permission-mode', variant: 'warning',
        message: 'Auto (YOLO): actions may run without approval.', durationMs: Number.POSITIVE_INFINITY });
    assert.equal(list.length, 1);
    // Leaving the policy retires it: a warning that outlived the policy would
    // be asserting something false about what the session may do.
    list = applyCodeNotice(list, { id: 'code:permission-mode', clear: true });
    assert.deepEqual(list, []);
    // Clearing something that was never raised is a no-op, not an error.
    assert.deepEqual(applyCodeNotice(list, { id: 'code:permission-mode', clear: true }), []);
});

test('a notice with no finite duration waits for the reader', () => {
    assert.equal(codeToastAutoDismisses({ ...notice('x'), revision: 1 }), true);
    assert.equal(codeToastAutoDismisses({ ...notice('x'), durationMs: Infinity, revision: 1 }), false);
    assert.equal(codeToastAutoDismisses({ ...notice('x'), durationMs: 0, revision: 1 }), false);
    assert.equal(codeToastAutoDismisses({ ...notice('x'), durationMs: -1, revision: 1 }), false);
});

test('the stack is capped and drops the oldest, never the one just raised', () => {
    let list: CodeToast[] = [];
    for (const id of ['a', 'b', 'c', 'd']) list = pushCodeToast(list, notice(id));
    assert.equal(list.length, 3);
    assert.deepEqual(list.map(toast => toast.id), ['b', 'c', 'd']);
    // Re-raising an existing notice moves it newest, so the cap cannot evict
    // the thing the reader just triggered.
    list = pushCodeToast(list, notice('b'));
    assert.deepEqual(list.map(toast => toast.id), ['c', 'd', 'b']);
});

test('dismissing is by id and leaves the list alone when nothing matches', () => {
    const list = pushCodeToast(pushCodeToast([], notice('a')), notice('b'));
    assert.deepEqual(dismissCodeToast(list, 'a').map(toast => toast.id), ['b']);
    assert.equal(dismissCodeToast(list, 'missing'), list, 'no match returns the same reference');
});


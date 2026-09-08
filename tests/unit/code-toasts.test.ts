import test from 'node:test';
import assert from 'node:assert/strict';
import { CODE_TOAST_DEFAULT_MS, CODE_TOAST_MAX, codeToastAutoDismisses, codeToastIsAssertive,
    dismissCodeToast, pushCodeToast, type CodeToast } from '../../public/manager/src/code/code-toasts.ts';

const notice = (id: string, message = id) => ({ id, message, variant: 'info' as const, durationMs: CODE_TOAST_DEFAULT_MS });

test('a repeated notice replaces itself instead of stacking', () => {
    let list = pushCodeToast([], notice('policy', 'Auto (YOLO)'));
    list = pushCodeToast(list, notice('policy', 'Auto (YOLO) again'));
    assert.equal(list.length, 1);
    assert.equal(list[0]?.message, 'Auto (YOLO) again');
    // The revision is what restarts the timer for a notice that is already up.
    assert.equal(list[0]?.revision, 2);
});

test('the stack is capped and drops the oldest, never the one just raised', () => {
    let list: CodeToast[] = [];
    for (const id of ['a', 'b', 'c', 'd']) list = pushCodeToast(list, notice(id));
    assert.equal(list.length, CODE_TOAST_MAX);
    assert.deepEqual(list.map(toast => toast.id), ['b', 'c', 'd']);
    // Re-raising an existing notice moves it to the newest position, so the cap
    // cannot evict the thing the reader just triggered.
    list = pushCodeToast(list, notice('b'));
    assert.deepEqual(list.map(toast => toast.id), ['c', 'd', 'b']);
});

test('a notice with no finite duration waits for the reader', () => {
    assert.equal(codeToastAutoDismisses({ ...notice('x'), revision: 1 }), true);
    assert.equal(codeToastAutoDismisses({ ...notice('x'), durationMs: Infinity, revision: 1 }), false);
    assert.equal(codeToastAutoDismisses({ ...notice('x'), durationMs: 0, revision: 1 }), false);
    assert.equal(codeToastAutoDismisses({ ...notice('x'), durationMs: -1, revision: 1 }), false);
});

test('dismissing is by id and leaves the list alone when nothing matches', () => {
    const list = pushCodeToast(pushCodeToast([], notice('a')), notice('b'));
    assert.deepEqual(dismissCodeToast(list, 'a').map(toast => toast.id), ['b']);
    assert.equal(dismissCodeToast(list, 'missing'), list, 'no match returns the same reference');
});

test('only an error interrupts', () => {
    assert.equal(codeToastIsAssertive({ ...notice('a'), revision: 1 }), false);
    assert.equal(codeToastIsAssertive({ ...notice('a'), variant: 'warning', revision: 1 }), false);
    assert.equal(codeToastIsAssertive({ ...notice('a'), variant: 'error', revision: 1 }), true);
});


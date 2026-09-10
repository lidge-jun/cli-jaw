import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    clonePermissions,
    readSelectors,
    createIndependentBinding,
    admitDispatchContext,
    resolveAllowWrite,
    finishAssignment,
    prepareDispatchContext,
    dispatchAccessPath,
    authorizeDispatch,
    buildClaimReplayMeta,
} from '../../src/orchestrator/dispatch-admission.ts';
import { getActiveChatSession, createChatSession } from '../../src/core/chat-sessions.ts';
import { claimWorker, getWorkerSlot, cancelWorker } from '../../src/orchestrator/worker-registry.ts';
import { initBossToken } from '../../src/core/boss-auth.ts';

test('clonePermissions keeps strings and copies arrays', () => {
    assert.equal(clonePermissions('auto'), 'auto');
    assert.deepEqual(clonePermissions(['read', 'edit']), ['read', 'edit']);
    const source = ['read'];
    const cloned = clonePermissions(source);
    assert.ok(Array.isArray(cloned));
    source.push('mutated');
    assert.deepEqual(cloned, ['read']);
    assert.equal(clonePermissions(''), undefined);
    assert.equal(clonePermissions(12), undefined);
});

test('readSelectors requires the complete triple', () => {
    assert.deepEqual(readSelectors({}), { ok: true, present: false });
    assert.equal(readSelectors({ scopeKey: 'local:abc' }).ok, false);
    assert.equal((readSelectors({ scopeKey: 'local:abc' }) as { error?: string }).error, 'dispatch_context_invalid');
    assert.equal(readSelectors({ scopeKey: '', chatSessionId: 'a', requestId: 'b' }).ok, false);
    const ok = readSelectors({ scopeKey: 'local:abc', chatSessionId: 'deadbeef', requestId: 'wr_1' });
    assert.equal(ok.ok && ok.present, true);
});

test('createIndependentBinding uses local:<id> and does not activate the session', () => {
    const previous = getActiveChatSession();
    const created = createChatSession('keep-active', { activate: true });
    assert.equal(getActiveChatSession(), created.id);
    const independent = createIndependentBinding();
    assert.equal(getActiveChatSession(), created.id);
    assert.notEqual(independent.chatSessionId, created.id);
    assert.equal(independent.scopeKey, 'local:' + independent.chatSessionId);
    assert.equal(independent.origin, 'cli');
    assert.equal(independent.plan, null);
    assert.equal(independent.replayMeta.target, undefined);
    assert.equal(independent.replayMeta.chatId, undefined);
    assert.equal(previous === 'default' || typeof previous === 'string', true);
});

test('resolveAllowWrite treats B as build and phase 1/2/4 as readonly defaults', () => {
    assert.equal(resolveAllowWrite({ mutable: undefined, parentMutableFalse: false, orcState: 'B', bodyPhase: undefined, mode: 'full' }).ok
        && (resolveAllowWrite({ mutable: undefined, parentMutableFalse: false, orcState: 'B', bodyPhase: undefined, mode: 'full' }) as { allowWrite: boolean }).allowWrite, true);
    assert.equal((resolveAllowWrite({ mutable: undefined, parentMutableFalse: false, orcState: 'A', bodyPhase: undefined, mode: 'full' }) as { allowWrite?: boolean }).allowWrite, false);
    assert.equal((resolveAllowWrite({ mutable: undefined, parentMutableFalse: false, orcState: 'IDLE', bodyPhase: 1, mode: 'full' }) as { allowWrite?: boolean }).allowWrite, false);
    assert.equal((resolveAllowWrite({ mutable: undefined, parentMutableFalse: false, orcState: 'IDLE', bodyPhase: 2, mode: 'full' }) as { allowWrite?: boolean }).allowWrite, false);
    assert.equal((resolveAllowWrite({ mutable: undefined, parentMutableFalse: false, orcState: 'IDLE', bodyPhase: 4, mode: 'full' }) as { allowWrite?: boolean }).allowWrite, false);
    assert.equal((resolveAllowWrite({ mutable: true, parentMutableFalse: false, orcState: 'A', bodyPhase: 2, mode: 'full' }) as { allowWrite?: boolean }).allowWrite, true);
    assert.equal(resolveAllowWrite({ mutable: true, parentMutableFalse: true, orcState: 'IDLE', bodyPhase: undefined, mode: 'full' }).ok, false);
});

test('authorizeDispatch and access path prefer full then boss then approval', () => {
    const full = { headers: {} };
    assert.deepEqual(authorizeDispatch(full, () => true), { ok: true, mode: 'full' });
    assert.equal(dispatchAccessPath(full, true), 'direct');
    const token = initBossToken();
    const boss = { headers: { 'x-jaw-boss-token': token } };
    assert.deepEqual(authorizeDispatch(boss, () => false), { ok: true, mode: 'boss' });
    assert.equal(dispatchAccessPath(boss, false), 'boss');
    assert.equal(dispatchAccessPath({ headers: {} }, false), 'approval');
    assert.equal(authorizeDispatch({ headers: {} }, () => false).ok, false);
});

test('employee header without selectors is dispatch_context_required', () => {
    const result = prepareDispatchContext({
        headers: { 'x-jaw-employee-mode': '1' },
        body: { task: 'x' },
    }, () => true);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'dispatch_context_required');
});

test('live worker triple matches and parent noDescendants denies before finish', () => {
    const slot = claimWorker({ id: 'emp-no-desc', name: 'NoDesc' }, 'parent', {
        origin: 'cli',
        scopeId: 'local:parent',
        chatSessionId: 'default',
        requestId: 'ignored',
        noDescendants: true,
        mutable: true,
        permissions: ['read'],
    });
    try {
        const prepared = prepareDispatchContext({
            headers: { 'x-jaw-employee-mode': '1' },
            body: {
                scopeKey: 'local:parent',
                chatSessionId: 'default',
                requestId: slot.runId,
            },
        }, () => true);
        assert.equal(prepared.ok, false);
        if (!prepared.ok) assert.equal(prepared.error, 'dispatch_no_descendants');
    } finally {
        cancelWorker(slot.agentId);
    }
});

test('selected live slot clones permissions onto claim meta', () => {
    const perms = ['read', 'edit'];
    const slot = claimWorker({ id: 'emp-slot-meta', name: 'SlotMeta' }, 'parent', {
        origin: 'web',
        scopeId: 'default',
        chatSessionId: 'default',
        requestId: 'req-parent',
        mutable: false,
        permissions: perms,
    });
    try {
        const prepared = prepareDispatchContext({
            body: {
                scopeKey: 'default',
                chatSessionId: 'default',
                requestId: slot.runId,
            },
        }, () => true);
        assert.equal(prepared.ok, true);
        if (!prepared.ok) return;
        assert.equal(prepared.ctx.parentMutableFalse, true);
        assert.deepEqual(prepared.ctx.permissions, ['read', 'edit']);
        perms.push('mutated');
        assert.deepEqual(prepared.ctx.permissions, ['read', 'edit']);
        const finished = finishAssignment(prepared.ctx, {});
        assert.equal(finished.ok, true);
        if (!finished.ok) return;
        assert.equal(finished.assignment.allowWrite, false);
        const meta = buildClaimReplayMeta(finished.assignment);
        assert.equal(meta.mutable, false);
        assert.deepEqual(meta.permissions, ['read', 'edit']);
    } finally {
        cancelWorker(slot.agentId);
    }
});

test('headerless full defers independent persistence until admitted', () => {
    const prepared = prepareDispatchContext({ headers: {}, body: { task: 'do it' } }, () => true);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.equal(prepared.ctx.scopeKey, '');
    assert.equal(prepared.ctx.chatSessionId, '');
    admitDispatchContext(prepared.ctx, []);
    assert.match(prepared.ctx.scopeKey, /^local:/);
    const id = prepared.ctx.chatSessionId;
    admitDispatchContext(prepared.ctx, []);
    assert.equal(prepared.ctx.chatSessionId, id);
    assert.equal(prepared.ctx.origin, 'cli');
    assert.equal(prepared.ctx.plan, null);
});

test('completed worker selectors are stale, and empty permission profiles stay arrays', () => {
    assert.deepEqual(clonePermissions([]), []);
    const slot = claimWorker({ id: 'stale-parent' }, 'parent', {
        scopeId: 'default', chatSessionId: 'default', mutable: false,
    });
    cancelWorker(slot.agentId);
    const result = prepareDispatchContext({ body: {
        scopeKey: 'default', chatSessionId: 'default', requestId: slot.runId,
    } }, () => true);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
});

test('malformed policy fields are rejected rather than promoted to full defaults', () => {
    const ctx = createIndependentBinding();
    for (const item of [{ mutable: 'false' }, { noDescendants: 'true' }, { phase: 99 }]) {
        const result = finishAssignment(ctx, item);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.status, 400);
    }
});

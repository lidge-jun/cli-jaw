import test from 'node:test';
import assert from 'node:assert/strict';
import { createSlackReplyDeliveryLedger } from '../../src/slack/reply-delivery.ts';
import type { RemoteTarget } from '../../src/messaging/types.ts';
const target: RemoteTarget = { channel: 'slack', targetKind: 'channel', peerKind: 'direct', targetId: 'D_TEST', threadId: '1.1' };
function fixture() { let now = 0, sequence = 0; return { ledger: createSlackReplyDeliveryLedger({ now: () => now, nextAnchor: () => ++sequence }), at: (value: number) => { now = value; } }; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('known start anchor survives display expiry and never changes on repeated start', () => {
    const { ledger, at } = fixture(); ledger.remember('request', target, 'scope');
    assert.equal(ledger.anchor('request', target), undefined);
    assert.equal(ledger.started('request', target, 'scope'), 1);
    at(21 * 60_000);
    assert.equal(ledger.anchor('request', target), 1);
    assert.equal(ledger.started('request', target, 'scope'), 1);
    assert.equal(ledger.scope('request', target), 'scope');
});

test('claim is synchronous and duplicates join one whole workflow promise', async () => {
    const { ledger } = fixture(); const gate = deferred(); let called = 0;
    ledger.started('request', target, 'scope', 12);
    const first = ledger.deliver('request', target, async anchor => { called++; assert.equal(anchor, 12); await gate.promise; });
    assert.equal(called, 1);
    const second = ledger.deliver('request', target, async () => { called++; });
    assert.strictEqual(first, second); gate.resolve(); await first;
    await ledger.deliver('request', target, async () => { called++; });
    assert.equal(called, 1);
});

test('failed or ambiguous attempt is not automatically retried by a duplicate completion', async () => {
    const { ledger } = fixture(); let called = 0;
    await assert.rejects(ledger.deliver('request', target, async () => { called++; throw new Error('unconfirmed'); }), /unconfirmed/);
    await ledger.deliver('request', target, async () => { called++; }); assert.equal(called, 1);
});

test('known target/scope cannot be overwritten and conflicting completion cannot send', async () => {
    const { ledger } = fixture(); ledger.started('request', target, 'scope');
    const foreign = { ...target, targetId: 'D_OTHER' };
    ledger.remember('request', foreign, 'other');
    assert.equal(ledger.started('request', foreign, 'other'), undefined);
    assert.equal(ledger.started('request', target, 'other'), undefined);
    assert.equal(ledger.scope('request', target), 'scope');
    let called = false; await ledger.deliver('request', foreign, async () => { called = true; });
    assert.equal(called, false); assert.equal(ledger.claimed('request', target), false);
});

test('cache miss supplies no invented anchor and preserves an unproven body', async () => {
    const { ledger } = fixture(); let anchor: number | undefined = 9;
    await ledger.deliver('unknown', target, async value => { anchor = value; });
    assert.equal(anchor, undefined);
});

test('pending claim is never evicted by age or record capacity', async () => {
    const { ledger, at } = fixture(); const gate = deferred(); let called = 0;
    const first = ledger.deliver('pending', target, async () => { called++; await gate.promise; });
    at(5 * 60 * 60_000);
    for (let i = 0; i < 1200; i++) ledger.remember(`other-${i}`, target, 'scope');
    assert.strictEqual(ledger.deliver('pending', target, async () => { called++; }), first);
    gate.resolve(); await first;
    await ledger.deliver('pending', target, async () => { called++; }); assert.equal(called, 1);
});

test('expired cached proof is unavailable rather than replaced by current time', () => {
    const { ledger, at } = fixture(); ledger.started('request', target, 'scope');
    at(5 * 60 * 60_000); assert.equal(ledger.anchor('request', target), undefined);
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createActionMemory,
    validateMemoryHit,
    actionMemoryKey,
    ACTION_MEMORY_SCHEMA_VERSION,
} from '../../src/browser/web-ai/action-memory.js';

describe('G07 action memory (cli-jaw mirror)', () => {
    it('stores and retrieves by (origin,intent,signature)', () => {
        const m = createActionMemory();
        m.put({ origin: 'https://x.test', intentId: 'send.click', signature: 'sig-A', ref: '@e3', hits: 0, validations: { ok: 0, fail: 0 }, lastGoodAt: '' });
        const got = m.get('https://x.test', 'send.click', 'sig-A');
        assert.equal(got?.ref, '@e3');
    });

    it('returns null on signature drift', () => {
        const m = createActionMemory();
        m.put({ origin: 'https://x.test', intentId: 'send.click', signature: 'sig-A', ref: '@e3', hits: 0, validations: { ok: 0, fail: 0 }, lastGoodAt: '' });
        assert.equal(m.get('https://x.test', 'send.click', 'sig-B'), null);
    });

    it('validateMemoryHit rejects drift', () => {
        const m = createActionMemory();
        const e = m.put({ origin: 'https://x.test', intentId: 'send.click', signature: 'sig-A', ref: '@e3', hits: 0, validations: { ok: 0, fail: 0 }, lastGoodAt: '' });
        assert.deepEqual(validateMemoryHit(e, 'sig-A'), e);
        assert.equal(validateMemoryHit(e, 'sig-B'), null);
        assert.equal(validateMemoryHit(null, 'sig-A'), null);
    });

    it('records replay outcomes', () => {
        const m = createActionMemory();
        m.put({ origin: 'https://x.test', intentId: 'i', signature: 's', ref: '@e1', hits: 0, validations: { ok: 0, fail: 0 }, lastGoodAt: '' });
        m.recordReplay('https://x.test', 'i', 's', 'ok');
        m.recordReplay('https://x.test', 'i', 's', 'fail');
        const e = m.get('https://x.test', 'i', 's');
        assert.equal(e?.hits, 1);
        assert.deepEqual(e?.validations, { ok: 1, fail: 1 });
    });

    it('list+clear', () => {
        const m = createActionMemory();
        m.put({ origin: 'https://a.test', intentId: 'i', signature: 's', ref: '@e1', hits: 0, validations: { ok: 0, fail: 0 }, lastGoodAt: '' });
        m.put({ origin: 'https://b.test', intentId: 'i', signature: 's', ref: '@e2', hits: 0, validations: { ok: 0, fail: 0 }, lastGoodAt: '' });
        assert.equal(m.list().length, 2);
        assert.equal(m.list('https://a.test').length, 1);
        m.clear();
        assert.equal(m.size(), 0);
    });

    it('snapshot round-trips', () => {
        const m = createActionMemory();
        m.put({ origin: 'https://x.test', intentId: 'i', signature: 's', ref: '@e1', hits: 0, validations: { ok: 0, fail: 0 }, lastGoodAt: '' });
        const snap = m.snapshot();
        assert.equal(snap.schemaVersion, ACTION_MEMORY_SCHEMA_VERSION);
        const m2 = createActionMemory({ initial: snap });
        assert.equal(m2.size(), 1);
    });

    it('rejects malformed put', () => {
        const m = createActionMemory();
        assert.throws(() => m.put({ origin: 'x' } as never));
    });

    it('actionMemoryKey is stable', () => {
        assert.equal(actionMemoryKey('https://x.test', 'send.click', 'sig-A'), 'https://x.test::send.click::sig-A');
    });
});

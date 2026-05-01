import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installHiddenUnloadWatcher } from '../../public/manager/src/lib/use-hidden-unload.ts';

type Listener = (e?: unknown) => void;

function makeFakeDoc(initialHidden: boolean) {
    const listeners = new Map<string, Set<Listener>>();
    const doc = {
        hidden: initialHidden,
        addEventListener(type: string, cb: Listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(cb);
        },
        removeEventListener(type: string, cb: Listener) {
            listeners.get(type)?.delete(cb);
        },
        emit(type: string = 'visibilitychange') {
            for (const cb of listeners.get(type) ?? []) cb();
        },
        listenerCount() {
            let count = 0;
            for (const set of listeners.values()) count += set.size;
            return count;
        },
    };
    return doc;
}

function makeFakeClock() {
    let now = 1_000_000;
    const tasks = new Map<number, { fire: () => void; at: number }>();
    let id = 0;
    return {
        now: () => now,
        setTimeout(cb: () => void, ms: number) {
            id += 1;
            const handle = id;
            tasks.set(handle, { fire: cb, at: now + ms });
            return handle;
        },
        clearTimeout(handle: unknown) {
            tasks.delete(handle as number);
        },
        advance(ms: number) {
            now += ms;
            for (const [handle, task] of [...tasks.entries()]) {
                if (task.at <= now) {
                    tasks.delete(handle);
                    task.fire();
                }
            }
        },
    };
}

describe('installHiddenUnloadWatcher', () => {
    it('fires onUnload once after idle threshold while hidden', () => {
        const doc = makeFakeDoc(false);
        const clock = makeFakeClock();
        let fired = 0;
        const cleanup = installHiddenUnloadWatcher({
            onUnload: () => { fired += 1; },
            idleMs: 5_000,
            doc,
            setTimeout: clock.setTimeout,
            clearTimeout: clock.clearTimeout,
            now: clock.now,
        });

        doc.hidden = true;
        doc.emit();
        clock.advance(4_999);
        assert.equal(fired, 0);
        clock.advance(2);
        assert.equal(fired, 1);
        clock.advance(60_000);
        assert.equal(fired, 1, 'should fire only once');
        cleanup();
    });

    it('clears timer when becoming visible before threshold', () => {
        const doc = makeFakeDoc(false);
        const clock = makeFakeClock();
        let fired = 0;
        const cleanup = installHiddenUnloadWatcher({
            onUnload: () => { fired += 1; },
            idleMs: 5_000,
            doc,
            setTimeout: clock.setTimeout,
            clearTimeout: clock.clearTimeout,
            now: clock.now,
        });
        doc.hidden = true;
        doc.emit();
        clock.advance(2_000);
        doc.hidden = false;
        doc.emit();
        clock.advance(10_000);
        assert.equal(fired, 0);
        cleanup();
    });

    it('fires immediately on visible if elapsed hidden time crossed threshold (throttled timer)', () => {
        const doc = makeFakeDoc(false);
        const clock = makeFakeClock();
        let fired = 0;
        installHiddenUnloadWatcher({
            onUnload: () => { fired += 1; },
            idleMs: 5_000,
            doc,
            setTimeout(cb, _ms) {
                // Simulate a frozen background timer: callback never runs.
                void cb;
                return 1;
            },
            clearTimeout: clock.clearTimeout,
            now: clock.now,
        });
        doc.hidden = true;
        doc.emit();
        clock.advance(7_000);
        doc.hidden = false;
        doc.emit();
        assert.equal(fired, 1);
    });

    it('cleanup removes listener', () => {
        const doc = makeFakeDoc(false);
        const clock = makeFakeClock();
        const cleanup = installHiddenUnloadWatcher({
            onUnload: () => {},
            idleMs: 5_000,
            doc,
            setTimeout: clock.setTimeout,
            clearTimeout: clock.clearTimeout,
            now: clock.now,
        });
        // visibilitychange + resume listeners both registered
        assert.equal(doc.listenerCount(), 2);
        cleanup();
        assert.equal(doc.listenerCount(), 0);
    });

    it('fires on resume event when timer was frozen and threshold elapsed', () => {
        const doc = makeFakeDoc(false);
        const clock = makeFakeClock();
        let fired = 0;
        installHiddenUnloadWatcher({
            onUnload: () => { fired += 1; },
            idleMs: 5_000,
            doc,
            setTimeout(cb, _ms) {
                void cb;
                return 1;
            },
            clearTimeout: clock.clearTimeout,
            now: clock.now,
        });
        doc.hidden = true;
        doc.emit('visibilitychange');
        clock.advance(7_000);
        // Page Lifecycle: frozen → resume (no visibilitychange edge required)
        doc.hidden = false;
        doc.emit('resume');
        assert.equal(fired, 1);
    });
});

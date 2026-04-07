// ── Streaming Render Tests ──
// Tests the REAL streaming-render.ts exports with mocked browser globals.
// render.js is mocked to avoid pulling in marked/highlight.js/mermaid.

import { describe, it, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const RENDER_PATH = resolve(ROOT, 'public/js/render.js');

type StreamMod = typeof import('../../public/js/streaming-render.ts');
let createStreamRenderer: StreamMod['createStreamRenderer'];
let appendChunk: StreamMod['appendChunk'];
let finalizeStream: StreamMod['finalizeStream'];

// Capture rAF/cAF calls for assertions
let rafCallbacks: Array<() => void> = [];
let rafIdCounter = 1;
let cancelledRafs: number[] = [];

before(async () => {
    // Stub browser globals BEFORE importing source
    (globalThis as any).requestAnimationFrame = (cb: () => void): number => {
        const id = rafIdCounter++;
        rafCallbacks.push(cb);
        return id;
    };
    (globalThis as any).cancelAnimationFrame = (id: number): void => {
        cancelledRafs.push(id);
    };

    // Mock render.js — renderMarkdown returns identity for predictable assertions
    mock.module(RENDER_PATH, {
        namedExports: {
            renderMarkdown: (text: string) => `<p>${text}</p>`,
            escapeHtml: (s: string) => s,
        },
    });

    const mod = await import('../../public/js/streaming-render.ts');
    createStreamRenderer = mod.createStreamRenderer;
    appendChunk = mod.appendChunk;
    finalizeStream = mod.finalizeStream;
});

/** Flush all pending rAF callbacks synchronously */
function flushRAF(): void {
    const pending = [...rafCallbacks];
    rafCallbacks = [];
    pending.forEach(cb => cb());
}

/** Create a minimal HTMLElement stub */
function makeElement(): HTMLElement {
    return { innerHTML: '' } as unknown as HTMLElement;
}

beforeEach(() => {
    rafCallbacks = [];
    rafIdCounter = 1;
    cancelledRafs = [];
});

describe('streaming-render', () => {
    describe('createStreamRenderer', () => {
        it('returns initial empty state with correct shape', () => {
            const el = makeElement();
            const ss = createStreamRenderer(el);
            assert.equal(ss.fullText, '');
            assert.equal(ss.isFinalized, false);
            assert.equal(ss.pendingRAF, null);
            assert.strictEqual(ss.element, el);
        });
    });

    describe('appendChunk', () => {
        it('accumulates text chunks in fullText', () => {
            const ss = createStreamRenderer(makeElement());
            appendChunk(ss, 'Hello');
            assert.equal(ss.fullText, 'Hello');
            appendChunk(ss, ' World');
            assert.equal(ss.fullText, 'Hello World');
        });

        it('schedules exactly one rAF per batch', () => {
            const ss = createStreamRenderer(makeElement());
            appendChunk(ss, 'a');
            appendChunk(ss, 'b');
            appendChunk(ss, 'c');
            // Only 1 rAF scheduled despite 3 chunks (coalescing)
            assert.equal(rafCallbacks.length, 1);
        });

        it('renders accumulated text + cursor on rAF flush', () => {
            const el = makeElement();
            const ss = createStreamRenderer(el);
            appendChunk(ss, 'Hello');
            appendChunk(ss, ' World');
            flushRAF();
            // renderMarkdown returns <p>text</p>, plus cursor span
            assert.ok(el.innerHTML.includes('<p>Hello World</p>'));
            assert.ok(el.innerHTML.includes('stream-cursor'));
            assert.ok(el.innerHTML.includes('aria-hidden="true"'));
        });

        it('clears pendingRAF after rAF fires', () => {
            const ss = createStreamRenderer(makeElement());
            appendChunk(ss, 'text');
            assert.notEqual(ss.pendingRAF, null, 'pendingRAF should be set');
            flushRAF();
            assert.equal(ss.pendingRAF, null, 'pendingRAF should be null after flush');
        });

        it('schedules new rAF after previous one fires', () => {
            const ss = createStreamRenderer(makeElement());
            appendChunk(ss, 'first');
            flushRAF();
            appendChunk(ss, ' second');
            // New rAF should be scheduled
            assert.equal(rafCallbacks.length, 1);
            flushRAF();
            assert.ok(ss.element.innerHTML.includes('first second'));
        });

        it('does not render after finalization', () => {
            const el = makeElement();
            const ss = createStreamRenderer(el);
            appendChunk(ss, 'Before');
            finalizeStream(ss);
            const frozenHtml = el.innerHTML;
            appendChunk(ss, ' After');
            // fullText still accumulates
            assert.equal(ss.fullText, 'Before After');
            // But no new rAF should fire
            flushRAF();
            assert.equal(el.innerHTML, frozenHtml, 'innerHTML must not change after finalization');
        });

        it('handles empty chunks gracefully', () => {
            const ss = createStreamRenderer(makeElement());
            appendChunk(ss, '');
            assert.equal(ss.fullText, '');
        });
    });

    describe('finalizeStream', () => {
        it('returns accumulated text', () => {
            const ss = createStreamRenderer(makeElement());
            appendChunk(ss, 'Hello ');
            flushRAF();
            appendChunk(ss, 'World');
            const result = finalizeStream(ss);
            assert.equal(result, 'Hello World');
        });

        it('marks state as finalized', () => {
            const ss = createStreamRenderer(makeElement());
            finalizeStream(ss);
            assert.equal(ss.isFinalized, true);
        });

        it('cancels pending rAF via cancelAnimationFrame', () => {
            const ss = createStreamRenderer(makeElement());
            appendChunk(ss, 'text');
            assert.notEqual(ss.pendingRAF, null);
            const rafId = ss.pendingRAF;
            finalizeStream(ss);
            assert.equal(ss.pendingRAF, null);
            assert.ok(cancelledRafs.includes(rafId!), 'cancelAnimationFrame must be called');
        });

        it('renders final HTML without cursor', () => {
            const el = makeElement();
            const ss = createStreamRenderer(el);
            appendChunk(ss, 'Final text');
            finalizeStream(ss);
            assert.ok(el.innerHTML.includes('<p>Final text</p>'));
            assert.ok(!el.innerHTML.includes('stream-cursor'), 'cursor must be removed on finalize');
        });

        it('handles empty stream', () => {
            const el = makeElement();
            const ss = createStreamRenderer(el);
            const result = finalizeStream(ss);
            assert.equal(result, '');
            assert.equal(ss.isFinalized, true);
        });

        it('handles double finalization idempotently', () => {
            const ss = createStreamRenderer(makeElement());
            appendChunk(ss, 'text');
            flushRAF();
            const first = finalizeStream(ss);
            const second = finalizeStream(ss);
            assert.equal(first, second);
            assert.equal(ss.isFinalized, true);
        });

        it('multi-chunk then finalize preserves full text', () => {
            const ss = createStreamRenderer(makeElement());
            ['The ', 'quick ', 'brown ', 'fox'].forEach(c => appendChunk(ss, c));
            const result = finalizeStream(ss);
            assert.equal(result, 'The quick brown fox');
        });
    });
});

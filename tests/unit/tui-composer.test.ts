import test from 'node:test';
import assert from 'node:assert/strict';
import {
    appendPasteToComposer,
    appendTextToComposer,
    backspaceComposer,
    clearComposer,
    consumePasteProtocol,
    createComposerState,
    createPasteCaptureState,
    flattenComposerForSubmit,
    getComposerDisplayText,
    getPlainCommandDraft,
} from '../../src/cli/tui/composer.ts';

test('short single-line paste is absorbed into trailing text', () => {
    const composer = createComposerState();
    appendTextToComposer(composer, 'hello ');
    appendPasteToComposer(composer, 'world');

    assert.equal(composer.segments.length, 1);
    assert.equal(getComposerDisplayText(composer), 'hello world');
    assert.equal(flattenComposerForSubmit(composer), 'hello world');
});

test('multiline paste becomes a collapsed paste segment', () => {
    const composer = createComposerState();
    appendTextToComposer(composer, 'prefix ');
    appendPasteToComposer(composer, 'a\nb\nc');

    assert.equal(composer.segments.length, 3);
    assert.ok(getComposerDisplayText(composer).includes('[Pasted text #1 +2 lines]'));
    assert.equal(flattenComposerForSubmit(composer), 'prefix a\nb\nc');
    assert.equal(getPlainCommandDraft(composer), null);
});

test('backspace removes trailing paste block atomically', () => {
    const composer = createComposerState();
    appendPasteToComposer(composer, 'a\nb\nc');

    assert.ok(getComposerDisplayText(composer).includes('[Pasted text #1 +2 lines]'));
    backspaceComposer(composer);
    assert.equal(getComposerDisplayText(composer), '');
    assert.equal(flattenComposerForSubmit(composer), '');
});

test('plain command draft only exists for single text segment without newline', () => {
    const composer = createComposerState();
    appendTextToComposer(composer, '/help');
    assert.equal(getPlainCommandDraft(composer), '/help');

    clearComposer(composer);
    appendTextToComposer(composer, '/help\nmore');
    assert.equal(getPlainCommandDraft(composer), null);
});

test('consumePasteProtocol preserves normal escape sequences', () => {
    const composer = createComposerState();
    const capture = createPasteCaptureState();

    const tokens = consumePasteProtocol('\x1b[A', capture, composer);
    assert.deepEqual(tokens, ['\x1b[A']);
    assert.equal(getComposerDisplayText(composer), '');
});

test('consumePasteProtocol handles fragmented bracketed paste markers', () => {
    const composer = createComposerState();
    const capture = createPasteCaptureState();

    const first = consumePasteProtocol('\x1b[2', capture, composer);
    assert.deepEqual(first, []);
    assert.equal(capture.carry, '\x1b[2');

    const second = consumePasteProtocol('00~line1\nline2\x1b[201~', capture, composer);
    assert.deepEqual(second, []);
    assert.ok(getComposerDisplayText(composer).includes('[Pasted text #1 +1 lines]'));
    assert.equal(flattenComposerForSubmit(composer), 'line1\nline2');
});

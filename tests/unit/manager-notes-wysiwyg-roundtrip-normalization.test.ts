import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
    markdownRoundTripNormalizationPolicy,
    normalizeMarkdownForRoundTrip,
} from '../../public/manager/src/notes/wysiwyg/markdown-roundtrip';

const projectRoot = join(import.meta.dirname, '..', '..');

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

test('markdown round-trip normalization is conservative and idempotent', () => {
    const input = '\uFEFFline\r\n\n\n';
    const normalized = normalizeMarkdownForRoundTrip(input);

    assert.equal(markdownRoundTripNormalizationPolicy.finalNewline, 'single');
    assert.equal(normalized, 'line\n');
    assert.equal(normalizeMarkdownForRoundTrip(normalized), normalized);
});

test('normalization preserves meaningful markdown fixture content', () => {
    const code = read('tests/fixtures/manager-notes-wysiwyg/fenced-code-ts.input.md');
    const math = read('tests/fixtures/manager-notes-wysiwyg/math-inline-block.input.md');
    const rawHtml = read('tests/fixtures/manager-notes-wysiwyg/raw-html.input.md');
    const lineBreaks = read('tests/fixtures/manager-notes-wysiwyg/line-breaks.input.md');

    assert.ok(normalizeMarkdownForRoundTrip(code).includes('const value: number = 1;'));
    assert.ok(normalizeMarkdownForRoundTrip(math).includes('\\int_0^1 x^2 dx'));
    assert.ok(normalizeMarkdownForRoundTrip(rawHtml).includes('onerror=alert(1)'));
    assert.ok(normalizeMarkdownForRoundTrip(lineBreaks).includes('line one  \nline two'));
});

test('round-trip normalizer is not wired into the Notes save path', () => {
    const noteDocument = read('public/manager/src/notes/useNoteDocument.ts');
    assert.equal(noteDocument.includes('normalizeMarkdownForRoundTrip'), false);
    assert.ok(noteDocument.includes('saveNoteFile({'), 'Notes must still save the editor markdown content through the existing save path');
});

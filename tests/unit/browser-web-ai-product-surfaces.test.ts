import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = fs.readFileSync(join(root, 'src/browser/web-ai/product-surfaces.ts'), 'utf8');
const indexSrc = fs.readFileSync(join(root, 'src/browser/web-ai/index.ts'), 'utf8');

test('SURF-001: product surface index covers PRD32.9 surfaces', () => {
    for (const id of [
        'chatgpt-projects',
        'chatgpt-library',
        'chatgpt-apps',
        'chatgpt-deep-research',
        'gemini-deep-research',
        'canvas',
    ]) {
        assert.ok(src.includes(id), `${id} must be indexed`);
    }
});

test('SURF-002: surface detectors are read-only / no mutation allowed', () => {
    assert.match(src, /mutationAllowed:\s*false/);
    assert.doesNotMatch(src, /\.click\(/);
    assert.doesNotMatch(src, /keyboard\./);
    assert.doesNotMatch(src, /setInputFiles/);
});

test('SURF-003: product surface index is exported', () => {
    assert.match(indexSrc, /product-surfaces\.js/);
});

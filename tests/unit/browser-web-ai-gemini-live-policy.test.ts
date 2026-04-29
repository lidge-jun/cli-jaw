import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const geminiLiveSrc = readFileSync(join(root, 'src/browser/web-ai/gemini-live.ts'), 'utf8');

test('GEM-LIVE-001: Gemini upload stays fail-closed before browser mutation', () => {
    assert.match(geminiLiveSrc, /gemini file\/context upload is not implemented/);
    assert.match(geminiLiveSrc, /attachment-preflight/);
});

test('GEM-LIVE-002: Deep Think activation cannot silently degrade to default Gemini mode', () => {
    assert.match(geminiLiveSrc, /active Deep Think chip was not verified/);
    assert.doesNotMatch(geminiLiveSrc, /deep-think-not-activated/);
    assert.doesNotMatch(geminiLiveSrc, /default mode\)/);
});


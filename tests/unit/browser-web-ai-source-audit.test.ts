import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSources, extractInlineSources } from '../../src/browser/web-ai/source-audit.ts';

test('source audit extracts inline markdown and bare URL sources', () => {
    assert.deepEqual(extractInlineSources('Claim [Source](https://example.com/a). Also https://openai.com.'), [
        'https://example.com/a',
        'https://openai.com',
    ]);
});

test('source audit reports unsourced claims and absence-scope gaps', () => {
    const result = auditSources('No official response was found.', {
        requiredSourceRatio: 1,
    });

    assert.equal(result.ok, false);
    assert.equal(result.unsourcedClaims.length, 1);
    assert.ok(result.gaps.some(gap => gap.code === 'unsourced-claims'));
    assert.ok(result.gaps.some(gap => gap.code === 'absence-scope-missing'));
});

test('source audit passes sourced absence claims with checked scope/date', () => {
    const result = auditSources('No official response was found after checking Google Blog on 2026-05-05. https://blog.google/', {
        requiredSourceRatio: 1,
        checkedScope: 'Google Blog',
        checkedDate: '2026-05-05',
    });

    assert.equal(result.ok, true);
    assert.equal(result.unsourcedClaims.length, 0);
});

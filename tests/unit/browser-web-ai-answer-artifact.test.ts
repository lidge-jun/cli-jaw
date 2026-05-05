import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createAnswerArtifact,
    summarizeAnswerArtifact,
    withAnswerArtifact,
} from '../../src/browser/web-ai/answer-artifact.ts';

test('answer artifact normalizes capture method and exactness', () => {
    const artifact = createAnswerArtifact({
        provider: 'chatgpt',
        sessionId: 's1',
        capturedBy: 'copy-button',
        markdown: '# Answer',
        text: '# Answer',
        warnings: ['fallback'],
    });

    assert.equal(artifact.capturedBy, 'copy-button');
    assert.equal(artifact.exactnessScore, 1);
    assert.equal(artifact.warnings.length, 1);
});

test('withAnswerArtifact attaches artifact without dropping legacy answerText', () => {
    const result = withAnswerArtifact({
        ok: true,
        vendor: 'grok',
        status: 'complete',
        answerText: 'Fact. https://example.com',
        warnings: [],
    });

    assert.equal(result.answerText, 'Fact. https://example.com');
    assert.equal(result.answerArtifact?.provider, 'grok');
    assert.equal(result.answerArtifact?.capturedBy, 'dom-fallback');
    assert.deepEqual(summarizeAnswerArtifact(result.answerArtifact).provider, 'grok');
});

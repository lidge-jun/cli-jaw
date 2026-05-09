import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlaceholderAssistantText, normalizeAssistantText } from '../../src/browser/web-ai/chatgpt-response.js';

test('ASTAB-001: placeholder patterns filter intermediate states', () => {
    assert.equal(isPlaceholderAssistantText('Thinking'), true);
    assert.equal(isPlaceholderAssistantText('Pro Thinking'), true);
    assert.equal(isPlaceholderAssistantText('Answer now'), true);
    assert.equal(isPlaceholderAssistantText('Finalizing answer'), true);
    assert.equal(isPlaceholderAssistantText('Searching the web…'), true);
    assert.equal(isPlaceholderAssistantText('Reading documents'), true);
    assert.equal(isPlaceholderAssistantText('Analyzing files'), true);
    assert.equal(isPlaceholderAssistantText(''), true);
    assert.equal(isPlaceholderAssistantText('  '), true);
});

test('ASTAB-002: real answers are not placeholders', () => {
    assert.equal(isPlaceholderAssistantText('Here is the Python code you requested'), false);
    assert.equal(isPlaceholderAssistantText('Yes'), false);
    assert.equal(isPlaceholderAssistantText('The answer is 42.'), false);
});

test('ASTAB-003: normalizeAssistantText strips reasoning prefix', () => {
    assert.equal(normalizeAssistantText('Thought for 12s\nHere is the answer'), 'Here is the answer');
    assert.equal(normalizeAssistantText('Thought for 120s This is Pro'), 'This is Pro');
});

test('ASTAB-004: chatgpt-response.ts has FINISHED_ACTIONS_SELECTOR and isResponseFinished', async () => {
    const fs: any = await import('node:fs');
    const src = fs.readFileSync(new URL('../../src/browser/web-ai/chatgpt-response.ts', import.meta.url), 'utf8');
    assert.match(src, /FINISHED_ACTIONS_SELECTOR/);
    assert.match(src, /isResponseFinished/);
    assert.match(src, /copy-turn-action-button/);
    assert.match(src, /good-response-turn-action-button/);
    assert.match(src, /bad-response-turn-action-button/);
});

test('ASTAB-005: chatgpt-response.ts uses adaptive stability window', async () => {
    const fs: any = await import('node:fs');
    const src = fs.readFileSync(new URL('../../src/browser/web-ai/chatgpt-response.ts', import.meta.url), 'utf8');
    assert.match(src, /adaptiveMs/);
    assert.match(src, /textLen\s*<\s*16/);
    assert.match(src, /textLen\s*<\s*40/);
    assert.match(src, /textLen\s*<\s*500/);
});

test('ASTAB-006: empty or whitespace text is filtered as placeholder', () => {
    assert.equal(isPlaceholderAssistantText('\n\n'), true);
    assert.equal(isPlaceholderAssistantText('\t'), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    detectSmokeResponse,
    isCodexSmokeTurn,
    buildContinuationPrompt,
} from '../../src/agent/smoke-detector.js';

test('smoke: detects English spawn-subagent pattern with high confidence', () => {
    const result = detectSmokeResponse(
        "I'll spawn a subagent to handle this task. Once it responds, I'll continue.",
        [],
        0,
        'codex',
    );
    assert.equal(result.isSmoke, true);
    assert.equal(result.confidence, 'high');
    assert.ok(result.matchedPattern);
});

test('smoke: detects Korean continuation pattern', () => {
    const result = detectSmokeResponse(
        '에이전트 응답이 돌아오면 계속 작업하겠습니다.',
        [],
        0,
        'codex',
    );
    assert.equal(result.isSmoke, true);
});

test('smoke: thinking-only activity downgrades to medium confidence', () => {
    const result = detectSmokeResponse(
        "I'll spawn a subagent to handle this task.",
        [{ icon: '💭', label: 'thinking...', toolType: 'thinking' }],
        0,
        'codex',
    );
    assert.equal(result.isSmoke, true);
    assert.equal(result.confidence, 'medium');
});

test('smoke: search activity means not smoke', () => {
    const result = detectSmokeResponse(
        "I'll spawn a subagent after researching this topic.",
        [{ icon: '🔍', label: 'search query', toolType: 'search' }],
        0,
        'codex',
    );
    assert.equal(result.isSmoke, false);
});

test('smoke: non-zero exit is not smoke', () => {
    const result = detectSmokeResponse(
        "I'll spawn a subagent to handle this task.",
        [],
        1,
        'codex',
    );
    assert.equal(result.isSmoke, false);
    assert.equal(result.reason, 'non-zero exit');
});

test('smoke: codex smoke turn requires agent message without command execution', () => {
    assert.equal(
        isCodexSmokeTurn([
            { type: 'item.completed', item: { type: 'agent_message', text: 'spawning agent...' } },
        ]),
        true,
    );
    assert.equal(
        isCodexSmokeTurn([
            { type: 'item.completed', item: { type: 'command_execution', command: 'ls' } },
            { type: 'item.completed', item: { type: 'agent_message', text: 'done' } },
        ]),
        false,
    );
});

test('smoke: continuation prompt embeds original task and direct-work guard', () => {
    const prompt = buildContinuationPrompt(
        'Refactor the auth module',
        'I will spawn a subagent to do this.',
    );
    assert.ok(prompt.includes('Refactor the auth module'));
    assert.ok(prompt.includes('Do the work yourself'));
    assert.ok(prompt.includes('Do NOT mention spawning agents'));
});

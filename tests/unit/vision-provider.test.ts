// The invocation used to be a literal array inside the pipeline, which is how
// it drifted from the documented safety position without anyone noticing:
// --dangerously-bypass-approvals-and-sandbox was passed unconditionally for a
// pure image-classification call, while the skill docs said cli-jaw never adds
// it automatically. A single wrong argument that no test could see.
//
// Spawning codex needs a live host, so these assert the argument list itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildVisionInvocation,
    explainExit,
    WINDOWS_SANDBOX_KILL_CODE,
    CODEXCLAW_PLUGIN_DISABLE_CONFIG,
} from '../../src/browser/vision-provider.ts';

const base = { screenshotPath: '/tmp/shot.png', prompt: 'find the button' };

test('VP-001: the sandbox bypass is OFF by default', () => {
    // The whole point. An image-classification call does not need authority to
    // run arbitrary commands.
    const inv = buildVisionInvocation(base);
    assert.ok(!inv.args.includes('--dangerously-bypass-approvals-and-sandbox'));
    assert.equal(inv.bypassedSandbox, false);
});

test('VP-002: the bypass appears only when explicitly requested', () => {
    const inv = buildVisionInvocation({ ...base, bypassSandbox: true });
    assert.ok(inv.args.includes('--dangerously-bypass-approvals-and-sandbox'));
    assert.equal(inv.bypassedSandbox, true);
});

test('VP-003: only a literal true opts in', () => {
    // A truthy-ish value arriving from an HTTP body must not silently grant
    // both approvals and the sandbox.
    for (const value of [undefined, false, null, 0, '', 'true', 1, {}] as unknown[]) {
        const inv = buildVisionInvocation({ ...base, bypassSandbox: value as boolean });
        assert.equal(inv.bypassedSandbox, value === true, `${JSON.stringify(value)} must not opt in`);
    }
});

test('VP-004: the lookup is ephemeral and skips the git check', () => {
    const inv = buildVisionInvocation(base);
    assert.ok(inv.args.includes('--ephemeral'), 'a one-shot lookup must not persist a thread');
    assert.ok(inv.args.includes('--skip-git-repo-check'));
    assert.ok(inv.args.includes(CODEXCLAW_PLUGIN_DISABLE_CONFIG));
});

test('VP-005: the prompt is the last argument and is passed as one', () => {
    // Not shell-interpolated: a prompt carrying spaces or quotes stays a
    // single argv entry.
    const prompt = 'find the "Save as..." button; ignore everything else';
    const inv = buildVisionInvocation({ ...base, prompt });
    assert.equal(inv.args[inv.args.length - 1], prompt);
    assert.equal(inv.args.filter(a => a === prompt).length, 1);
});

test('VP-006: the screenshot path is passed as its own argument', () => {
    const inv = buildVisionInvocation({ ...base, screenshotPath: '/tmp/a b/shot 1.png' });
    const i = inv.args.indexOf('-i');
    assert.ok(i >= 0);
    assert.equal(inv.args[i + 1], '/tmp/a b/shot 1.png', 'a path with spaces stays intact');
});

test('VP-007: the Windows sandbox kill is explained, not reported as an empty failure', () => {
    // Exit -1073741502 with no stderr is the sandbox terminating the child.
    // Without this the caller sees an empty error and reasonably concludes the
    // model failed, which sends them looking in the wrong place.
    const msg = explainExit(WINDOWS_SANDBOX_KILL_CODE, '', false);
    assert.match(msg, /Windows sandbox/);
    assert.match(msg, /-1073741502/);
    assert.match(msg, /disables both approvals and the sandbox/);
});

test('VP-008: the same exit WITH the bypass on says something different', () => {
    // Suggesting the bypass to someone who already enabled it would be advice
    // that cannot help.
    const msg = explainExit(WINDOWS_SANDBOX_KILL_CODE, '', true);
    assert.match(msg, /even with the sandbox bypass enabled/);
    assert.doesNotMatch(msg, /Retry with the sandbox bypass/);
});

test('VP-009: a real error message is preserved rather than overwritten', () => {
    const msg = explainExit(1, 'authentication required', false);
    assert.match(msg, /code 1/);
    assert.match(msg, /authentication required/);
    assert.doesNotMatch(msg, /Windows sandbox/);
});

test('VP-010: the sandbox explanation needs BOTH the code and an empty stderr', () => {
    // That exit code with real stderr is a different failure that happens to
    // share a number; claiming the sandbox did it would be a guess.
    const msg = explainExit(WINDOWS_SANDBOX_KILL_CODE, 'model refused the request', false);
    assert.doesNotMatch(msg, /Windows sandbox/);
    assert.match(msg, /model refused the request/);
});

test('VP-011: stderr is bounded in the message', () => {
    const msg = explainExit(1, 'x'.repeat(5000), false);
    assert.ok(msg.length < 400, 'an error message must not carry five kilobytes of output');
});


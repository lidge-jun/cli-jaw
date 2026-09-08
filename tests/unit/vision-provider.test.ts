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
    WINDOWS_SANDBOX_KILL_CODE_UNSIGNED,
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

test('VP-012: the unsigned form of the Windows status is recognised too', () => {
    // Node normally reports a signed integer, but the value travels through
    // shells, wrappers and JSON round-trips where the unsigned form turns up.
    // Matching only one representation would mean the explanation silently
    // never fires on exactly the platform it exists for.
    assert.equal(WINDOWS_SANDBOX_KILL_CODE_UNSIGNED, 3221225794);
    assert.equal(WINDOWS_SANDBOX_KILL_CODE_UNSIGNED, WINDOWS_SANDBOX_KILL_CODE >>> 0);

    const msg = explainExit(WINDOWS_SANDBOX_KILL_CODE_UNSIGNED, '', false);
    assert.match(msg, /Windows sandbox/);
});

test('VP-013: a neighbouring status code is not claimed as the sandbox', () => {
    // 0xC0000142 is one specific status. Treating anything nearby as the same
    // cause would be a guess dressed as a diagnosis.
    assert.doesNotMatch(explainExit(-1073741501, '', false), /Windows sandbox/);
    assert.doesNotMatch(explainExit(-1073741506, '', false), /Windows sandbox/);
});

test('VP-014: the call sites that feed the builder are strict too', () => {
    // VP-003 tests buildVisionInvocation directly, which passed while the
    // production path did not: visionClick forwarded with a TRUTHY test, so
    // {"bypassSandbox":"false"} arriving over HTTP was coerced to a literal
    // true before the strict check ever saw it. Testing the pure function
    // while leaving the impure call sites permissive is exactly the failure
    // this phase was opened to fix, so the call sites are asserted here.
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = fs.readFileSync(join(root, 'src/browser/vision.ts'), 'utf8');

    const forwards = src.match(/opts\.bypassSandbox[^,;)\n]*/g) ?? [];
    assert.ok(forwards.length >= 3, 'every forwarding site must be present');
    for (const site of forwards) {
        assert.match(site, /opts\.bypassSandbox === true/, `permissive forward: ${site}`);
    }
});

test('VP-015: a truthy non-true value cannot reach the flag', () => {
    // The values that actually arrive from a JSON body.
    for (const value of ['false', 'yes', 1, {}, []] as unknown[]) {
        const forwarded = { screenshotPath: '/x.png', prompt: 'p', ...(value === true ? { bypassSandbox: true } : {}) };
        const inv = buildVisionInvocation(forwarded);
        assert.equal(inv.bypassedSandbox, false, `${JSON.stringify(value)} must not enable the bypass`);
        assert.ok(!inv.args.includes('--dangerously-bypass-approvals-and-sandbox'));
    }
});

test('VP-016: the agent path and the vision path are deliberately different', () => {
    // agent/args.ts adds the flag when the user selected Auto (YOLO). That is
    // not the contradiction it looks like: an agent turn exists to run
    // commands, so choosing Auto is the user accepting that. A vision lookup
    // runs none, so it starts from off. Pinning the distinction because the
    // two are easy to "unify" into whichever default someone read last.
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const agentSrc = fs.readFileSync(join(root, 'src/agent/args.ts'), 'utf8');

    const agentUse = agentSrc.match(/\.\.\.\(\s*autoPerm[^\n]*dangerously-bypass[^\n]*/);
    assert.ok(agentUse, 'the agent path must still gate the flag on the permission policy');

    // And it must remain gated - never unconditional.
    const unconditional = agentSrc.match(/^\s*'--dangerously-bypass-approvals-and-sandbox',/m);
    assert.equal(unconditional, null, 'the agent path must not add the flag unconditionally');

    // The vision path defaults off regardless of any agent-side policy.
    assert.equal(buildVisionInvocation({ screenshotPath: '/x.png', prompt: 'p' }).bypassedSandbox, false);
});
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    isSpawnableCliFile,
    prioritizeCliCandidates,
    selectSpawnableCliPath,
} from '../../src/core/cli-detect.ts';

function writeExecutable(dir: string, name: string, content: string): string {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, content);
    fs.chmodSync(filePath, 0o755);
    return filePath;
}

test('isSpawnableCliFile rejects executable text stubs without shebang', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-cli-detect-'));
    const stub = writeExecutable(dir, 'claude-broken', 'echo "Error: claude native binary not installed." >&2\n');

    const result = isSpawnableCliFile(stub, 'darwin');

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'text file without shebang');
});

test('selectSpawnableCliPath skips broken PATH candidates and chooses a later runnable script', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-cli-detect-'));
    const broken = writeExecutable(dir, 'claude-broken', 'echo "Error: claude native binary not installed." >&2\n');
    const working = writeExecutable(dir, 'claude-working', '#!/usr/bin/env sh\necho "2.1.126 (Claude Code)"\n');

    const result = selectSpawnableCliPath([broken, working], 'darwin');

    assert.equal(result.available, true);
    assert.equal(result.path, working);
    assert.deepEqual(result.rejected, [{ path: broken, reason: 'text file without shebang' }]);
});

test('selectSpawnableCliPath reports rejected candidates when none are spawnable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-cli-detect-'));
    const broken = writeExecutable(dir, 'claude-broken', 'echo "broken"\n');

    const result = selectSpawnableCliPath([broken], 'darwin');

    assert.equal(result.available, false);
    assert.equal(result.path, null);
    assert.deepEqual(result.rejected, [{ path: broken, reason: 'text file without shebang' }]);
});

test('prioritizeCliCandidates moves bun shims behind managed node bins for claude', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-cli-detect-home-'));
    const bunClaude = path.join(home, '.bun', 'bin', 'claude');
    const nvmClaude = path.join(home, '.nvm', 'versions', 'node', 'v22.18.0', 'bin', 'claude');
    const otherClaude = path.join('/opt/homebrew/bin', 'claude');

    const result = prioritizeCliCandidates('claude', [bunClaude, otherClaude, nvmClaude], home);

    assert.deepEqual(result, [nvmClaude, otherClaude, bunClaude]);
});

test('prioritizeCliCandidates keeps PATH order for codex/gemini/copilot/opencode (no bun deprio)', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-cli-detect-home-'));
    for (const cli of ['codex', 'gemini', 'copilot', 'opencode']) {
        const bunPath = path.join(home, '.bun', 'bin', cli);
        const nvmPath = path.join(home, '.nvm', 'versions', 'node', 'v22.18.0', 'bin', cli);
        const result = prioritizeCliCandidates(cli, [bunPath, nvmPath], home);
        assert.deepEqual(result, [bunPath, nvmPath], `${cli} order should be unchanged`);
    }
});

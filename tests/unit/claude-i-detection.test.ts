import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectCli, getClaudeIHelperCandidates } from '../../src/core/config.ts';

function writeExecutable(dir: string, name: string): string {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, '#!/usr/bin/env sh\necho jaw-claude-i 0.1.0\n');
    fs.chmodSync(filePath, 0o755);
    return filePath;
}

test('claude-i helper candidates prefer explicit env override', () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-claude-i-project-'));
    const explicit = path.join(projectDir, 'custom-helper');

    const candidates = getClaudeIHelperCandidates(projectDir, { JAW_CLAUDE_I_BIN: explicit });

    assert.equal(candidates[0], explicit);
    assert.ok(candidates.some((candidate) => candidate.includes(path.join('native', 'jaw-claude-i', 'target', 'release'))));
});

test('detectCli resolves claude-i through JAW_CLAUDE_I_BIN fallback', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-claude-i-bin-'));
    const helperName = process.platform === 'win32' ? 'jaw-claude-i.exe' : 'jaw-claude-i';
    const helper = writeExecutable(dir, helperName);
    const oldPath = process.env.PATH;
    const oldOverride = process.env.JAW_CLAUDE_I_BIN;

    try {
        process.env.PATH = path.join(dir, 'empty-path');
        process.env.JAW_CLAUDE_I_BIN = helper;
        const detected = detectCli('claude-i');
        assert.equal(detected.available, true);
        assert.equal(detected.path, helper);
    } finally {
        if (oldPath === undefined) delete process.env.PATH;
        else process.env.PATH = oldPath;
        if (oldOverride === undefined) delete process.env.JAW_CLAUDE_I_BIN;
        else process.env.JAW_CLAUDE_I_BIN = oldOverride;
    }
});

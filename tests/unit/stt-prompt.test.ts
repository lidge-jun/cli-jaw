import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadSttPrompt, resolveSttPromptPath } from '../../lib/stt.ts';

test('resolveSttPromptPath finds custom relative prompt path', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-stt-prompt-'));
    const promptsDir = path.join(root, 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    const promptFile = path.join(promptsDir, 'custom.md');
    fs.writeFileSync(promptFile, 'custom prompt');

    try {
        assert.equal(resolveSttPromptPath('prompts/custom.md', root), promptFile);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('loadSttPrompt falls back to default prompt when custom path is missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-stt-prompt-'));
    const promptsDir = path.join(root, 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, 'stt-system.md'), 'default prompt');

    try {
        assert.equal(loadSttPrompt('prompts/missing.md', root), 'default prompt');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('loadSttPrompt returns empty string when no prompt file exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaw-stt-prompt-'));
    try {
        assert.equal(loadSttPrompt('prompts/missing.md', root), '');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'node:child_process';

import {
    maybePromptGithubStar,
    starPromptStatePath,
    starRepo,
} from '../../bin/star-prompt.js';

test('GHS-001: starPromptStatePath honors CLI_JAW_HOME', async () => {
    const prev = process.env.CLI_JAW_HOME;
    const dir = await mkdtemp(join(tmpdir(), 'jaw-star-home-'));
    process.env.CLI_JAW_HOME = dir;
    try {
        assert.equal(starPromptStatePath(), join(dir, 'state', 'star-prompt.json'));
    } finally {
        if (prev === undefined) delete process.env.CLI_JAW_HOME;
        else process.env.CLI_JAW_HOME = prev;
        await rm(dir, { recursive: true, force: true });
    }
});

test('GHS-002: starRepo calls gh starred API with hidden Windows console', () => {
    let seenCommand = '';
    let seenArgs: readonly string[] = [];
    let seenOptions: SpawnSyncOptionsWithStringEncoding | undefined;

    const result = starRepo((
        command: string,
        args: readonly string[],
        options: SpawnSyncOptionsWithStringEncoding,
    ): SpawnSyncReturns<string> => {
        seenCommand = command;
        seenArgs = args;
        seenOptions = options;
        return {
            status: 0,
            signal: null,
            error: undefined,
            stdout: '',
            stderr: '',
            output: [],
            pid: 1,
        };
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(seenCommand, 'gh');
    assert.deepEqual(seenArgs, ['api', '-X', 'PUT', '/user/starred/lidge-jun/cli-jaw']);
    assert.equal(seenOptions?.windowsHide, true);
});

test('GHS-003: maybePromptGithubStar skips non-TTY sessions', async () => {
    let marked = false;
    await maybePromptGithubStar({
        stdinIsTTY: false,
        stdoutIsTTY: true,
        markPromptedFn: async () => { marked = true; },
    });
    assert.equal(marked, false);
});

test('GHS-004: maybePromptGithubStar marks once and thanks on successful star', async () => {
    const logs: string[] = [];
    let marked = false;

    await maybePromptGithubStar({
        stdinIsTTY: true,
        stdoutIsTTY: true,
        hasBeenPromptedFn: async () => false,
        isGhInstalledFn: () => true,
        markPromptedFn: async () => { marked = true; },
        askYesNoFn: async () => true,
        starRepoFn: () => ({ ok: true }),
        logFn: (message: string) => logs.push(message),
    });

    assert.equal(marked, true);
    assert.deepEqual(logs, ['[jaw] Thanks for the star!']);
});

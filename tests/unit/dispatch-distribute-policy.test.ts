import '../setup/isolated-home.ts';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
const spawnUrl = new URL('../../src/agent/spawn.ts', import.meta.url).href;
const realSpawn = await import('../../src/agent/spawn.ts');
type TestSpawnOpts = { permissions?: string | string[]; scopeKey?: string; chatSessionId?: string; requestId?: string; env?: Record<string, string>; sysPrompt?: string };
const calls: Array<{ prompt: string; opts: TestSpawnOpts }> = [];
mock.module(spawnUrl, { namedExports: { ...realSpawn,
    spawnAgent: (prompt: string, opts: TestSpawnOpts) => {
        calls.push({ prompt, opts });
        return { child: null, promise: Promise.resolve({ text: 'fixture done', code: 0 }) };
    },
} });
const { runSingleAgent } = await import('../../src/orchestrator/distribute.ts');
const { settings } = await import('../../src/core/config.ts');

test('actual distribute spawn carries captured Safe, local binding and full API prompts despite changed settings', async () => {
    const previousDirs = settings.projectDirs;
    settings.projectDirs = ['/another-project'];
    try {
        await runSingleAgent({ agent: 'Fixture', role: 'backend', task: 'Implement assigned file',
            currentPhase: 3, currentPhaseIdx: 0, phaseProfile: [3], mutable: true,
            fullAccess: true, allowDispatch: true, noDescendants: false },
            { id: 'virtual:fixture:policy', name: 'Fixture', cli: 'claude', model: 'fixture' }, {}, 1,
            { origin: 'cli', permissions: 'safe', scopeKey: 'local:child', chatSessionId: 'child',
                requestId: 'wr_child', workingDir: '/captured-project', projectDirs: ['/captured-project'] }, []);
        const call = calls.at(-1)!;
        assert.equal(call.opts.permissions, 'safe');
        assert.equal(call.opts.scopeKey, 'local:child');
        assert.equal(call.opts.chatSessionId, 'child');
        assert.equal(call.opts.requestId, 'wr_child');
        assert.equal(call.opts.env!.JAW_ASSIGNMENT_PARENT_REQUEST_ID, 'wr_child');
        assert.equal(call.opts.env!.JAW_WORKSPACE_ROOT, '/captured-project');
        assert.equal(call.opts.env!.JAW_PROJECT_DIRS, '["/captured-project"]');
        assert.match(call.opts.sysPrompt || '', /Provider approval mode: safe/);
        assert.match(call.opts.sysPrompt || '', /Jaw dispatch is available/);
        assert.doesNotMatch(call.prompt, /No delegation|server will reject \(HTTP 403\)|MUST NOT.*Task/);
    } finally { settings.projectDirs = previousDirs; }
});

test('actual distribute keeps read-only independent of delegation and leaf independent of write', async () => {
    for (const [mutable, allowDispatch, noDescendants] of [[false, true, false], [true, false, true]]) {
        await runSingleAgent({ agent: 'Fixture', role: 'backend', task: 'bounded work', currentPhase: mutable ? 3 : 4,
            currentPhaseIdx: 0, phaseProfile: [mutable ? 3 : 4], mutable, fullAccess: true, allowDispatch, noDescendants },
            { id: 'virtual:fixture:policy', name: 'Fixture', cli: 'claude', model: 'fixture' }, {}, 1,
            { origin: 'cli', permissions: ['read'], scopeKey: 'local:x', chatSessionId: 'x', requestId: 'wr_x',
                workingDir: '/captured-project', projectDirs: ['/captured-project'] }, []);
        const call = calls.at(-1)!;
        assert.deepEqual(call.opts.permissions, ['read']);
        assert.equal(call.opts.env!.JAW_ASSIGNMENT_MUTABLE, mutable ? '1' : '0');
        assert.equal(call.opts.env!.JAW_ASSIGNMENT_ALLOW_DISPATCH, allowDispatch ? '1' : '0');
        if (!mutable) assert.match(call.opts.sysPrompt || '', /File writes are blocked/);
        if (noDescendants) assert.match(call.opts.sysPrompt || '', /assignment forbids child agents/);
    }
});

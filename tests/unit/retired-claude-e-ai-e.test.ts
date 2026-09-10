import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'cli-jaw-retired-engines-'));
process.env['CLI_JAW_HOME'] = home;
after(() => rmSync(home, { recursive: true, force: true }));

const forbidden = () => assert.fail('retired admission launched a process or orchestration');
const processSeams = Object.fromEntries(
    ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'].map((name) => [name, forbidden]),
);
mock.module('node:child_process', {
    namedExports: { ...childProcess, ...processSeams },
    defaultExport: { ...childProcess, ...processSeams },
});
mock.module(resolve(import.meta.dirname, '../../src/cli/readiness.js'), {
    namedExports: { pickFirstReadyCli: () => 'codex-app' },
});

const config = await import('../../src/core/config.ts');
const runtime = await import('../../src/core/runtime-settings.ts');
const { isLiveFallbackCandidate } = await import('../../src/agent/lifecycle-handler.ts');
const { spawnAgent } = await import('../../src/agent/spawn.ts');
const { cliHandler } = await import('../../src/cli/handlers.ts');
const { employeeHandler } = await import('../../src/cli/employee-handler.ts');
const { steerHandler } = await import('../../src/cli/handlers-runtime.ts');
const { makeCommandCtx } = await import('../../src/cli/command-context.ts');

function writeSettings(value: unknown): void {
    writeFileSync(config.SETTINGS_PATH, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function retiredDocument(cli: 'claude-e' | 'ai-e'): Record<string, unknown> {
    return {
        ...structuredClone(config.DEFAULT_SETTINGS),
        settingsSchemaVersion: 4,
        cli,
        workingDir: home,
        perCli: {
            ...structuredClone(config.DEFAULT_SETTINGS.perCli),
            [cli]: { model: 'sonnet', effort: 'medium' },
        },
    };
}

function liveDocument(): Record<string, unknown> {
    return {
        ...structuredClone(config.DEFAULT_SETTINGS),
        settingsSchemaVersion: 4,
        cli: 'pi',
        workingDir: home,
        perCli: {
            ...structuredClone(config.DEFAULT_SETTINGS.perCli),
            pi: { model: 'grok-composer-2.5-fast', effort: 'high' },
        },
    };
}

for (const cli of ['claude-e', 'ai-e'] as const) {
    test('saved ' + cli + ' homes boot without locking persistence', async () => {
        writeSettings(retiredDocument(cli));
        const backupsBefore = readdirSync(home).filter((name) => name.includes('.corrupt-'));
        const loaded = config.loadSettings();
        assert.equal(loaded.cli, cli);
        assert.equal(loaded.runtimeSelectionDiagnostic, 'retired_runtime:' + cli);
        assert.equal(['absent', 'present'].includes(config.getSettingsPersistenceShape()), true);
        assert.equal(config.isSettingsPersistenceBlocked(), false);
        await runtime.applyRuntimeSettingsPatch({ showReasoning: true }, {
            restartMessaging: async () => {},
        });
        const persisted = JSON.parse(readFileSync(config.SETTINGS_PATH, 'utf8')) as Record<string, unknown>;
        assert.equal(persisted.cli, cli);
        assert.equal(persisted.showReasoning, true);
        assert.equal(Object.hasOwn(persisted, 'runtimeSelectionDiagnostic'), false);
        assert.deepEqual(readdirSync(home).filter((name) => name.includes('.corrupt-')), backupsBefore);
        assert.equal(config.loadSettings().cli, cli);
        assert.equal(config.loadSettings().runtimeSelectionDiagnostic, 'retired_runtime:' + cli);
    });
}

test('selecting or executing claude-e or ai-e is rejected with an engine-named diagnostic', async () => {
    writeSettings(liveDocument());
    config.loadSettings();
    const before = readFileSync(config.SETTINGS_PATH, 'utf8');
    await assert.rejects(runtime.applyRuntimeSettingsPatch({ cli: 'claude-e' }), { message: 'retired_runtime:claude-e' });
    await assert.rejects(runtime.applyRuntimeSettingsPatch({ cli: 'ai-e' }), { message: 'retired_runtime:ai-e' });
    assert.equal(readFileSync(config.SETTINGS_PATH, 'utf8'), before);

    const ctx = makeCommandCtx('web', 'en', {
        applySettings: () => { throw new Error('retired selection must not persist'); },
        clearSession: () => { throw new Error('retired selection must not clear session'); },
    });
    for (const cli of ['claude-e', 'ai-e'] as const) {
        const reply = await cliHandler([cli], ctx);
        assert.equal(reply.ok, false);
        assert.match(reply.text!, new RegExp('^retired_runtime:' + cli + ':'));
        const listed = (reply.text || '').split('Select an available runtime: ')[1] || '';
        assert.equal(listed.split(/,\s*/).includes('claude-e'), false);
        assert.equal(listed.split(/,\s*/).includes('ai-e'), false);
        const employee = await employeeHandler(['cli', 'x', cli], ctx);
        assert.equal(employee.ok, false);
        assert.match(employee.text!, new RegExp('^retired_runtime:' + cli + ':'));
        const employeeListed = (employee.text || '').split('Select an available runtime: ')[1] || '';
        assert.equal(employeeListed.split(/,\s*/).includes('claude-e'), false);
        assert.equal(employeeListed.split(/,\s*/).includes('ai-e'), false);
    }

    const spawn = spawnAgent('hello', { cli: 'claude-e', origin: 'web' });
    const settled = await spawn.promise;
    assert.equal(settled.code, 78);
    assert.match(settled.text, /retired_runtime:claude-e/);

    writeSettings(retiredDocument('claude-e'));
    config.loadSettings();
    const steer = await steerHandler(['keep going'], ctx);
    assert.equal(steer.ok, false);
    assert.equal(steer.text, 'retired_runtime:claude-e');
});

test('lifecycle fallback skips a retired first candidate and takes the next live one', () => {
    const detect = (name: string) => ({ available: name === 'claude-e' || name === 'codex' || name === 'ai-e' });
    const cool = () => false;
    assert.equal(isLiveFallbackCandidate('claude-e', 'pi', detect, cool), false);
    assert.equal(isLiveFallbackCandidate('ai-e', 'pi', detect, cool), false);
    assert.equal(isLiveFallbackCandidate('jwc', 'pi', detect, cool), false);
    assert.equal(isLiveFallbackCandidate('codex', 'pi', detect, cool), true);
    assert.equal(isLiveFallbackCandidate('pi', 'pi', detect, cool), false);

    const lifecycleSrc = readFileSync(join(import.meta.dirname, '../../src/agent/lifecycle-handler.ts'), 'utf8');
    assert.match(lifecycleSrc, /\.find\(\(fc: string\) => isLiveFallbackCandidate\(fc, cli/);

});

test('spawn stored fallbackCli shortcut is abandoned when the saved fallback is retired', () => {
    const spawnSrc = readFileSync(join(import.meta.dirname, '../../src/agent/spawn.ts'), 'utf8');
    assert.match(spawnSrc, /st\.retriesLeft <= 0/);
    assert.match(spawnSrc, /!isRetiredCliSelection\(st\.fallbackCli\)/);
    const guardIdx = spawnSrc.indexOf('!isRetiredCliSelection(st.fallbackCli)');
    const recurseIdx = spawnSrc.indexOf('return spawnAgent(prompt, {');
    assert.ok(guardIdx >= 0 && recurseIdx > guardIdx, 'recursive spawn must sit inside the retirement guard');
});

test('settings-channel fallback option does not rewrite claude-e to jwc', () => {
    const channelSrc = readFileSync(join(import.meta.dirname, '../../public/js/features/settings-channel.ts'), 'utf8');
    assert.doesNotMatch(channelSrc, /isRetiredCliSelection\(current\) \? '<option value="jwc"/);
    assert.match(channelSrc, /value="\$\{escapeHtml\(current\)\}"/);
});

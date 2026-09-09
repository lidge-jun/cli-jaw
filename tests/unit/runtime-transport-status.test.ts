import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import express from 'express';
import { once } from 'node:events';
import type { CliStatusRow, CliStatusSnapshot } from '../../src/cli/cli-status.ts';

const forbidden = test.mock.fn((): never => { throw new Error('status route must not probe or launch a process'); });
const processSeams = Object.fromEntries(
    ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'].map(name => [name, forbidden]),
);
test.mock.module('node:child_process', {
    namedExports: { ...childProcess, ...processSeams },
    defaultExport: { ...childProcess, ...processSeams },
});
const config = await import('../../src/core/config.ts');
const settings = { ...config.settings, perCli: {
    cursor: { transport: 'native' }, grok: { transport: 'native' },
    claude: { transport: 'native' }, 'codex-app': { transport: 'print' },
    pi: { transport: 'print' }, gemini: { transport: 'native' },
} };
test.mock.module('../../src/core/config.js', { namedExports: {
    ...config, settings, detectCli: forbidden, detectAllCli: forbidden,
} });
const baselineRow: CliStatusRow = {
    available: true, binaryInstalled: true, capabilityReady: true, authenticated: true,
    path: '/fixture/not-a-real-binary', source: 'cached-fixture', checkedCapability: 'print-probe',
    probeState: 'fresh',
};
const cached: CliStatusSnapshot = Object.freeze({
    cursor: Object.freeze({ ...baselineRow }),
    grok: Object.freeze({ ...baselineRow, available: false, capabilityReady: false, authenticated: false,
        probeState: 'failing', reason: 'fixture auth failure', probeError: 'fixture timeout',
        probeFailures: 3, nextRetryAt: 123456 }),
    claude: Object.freeze({ ...baselineRow, available: null, binaryInstalled: null, capabilityReady: null,
        authenticated: null, path: null, probeState: 'checking' }),
    'codex-app': Object.freeze({ ...baselineRow, checkedCapability: 'app-server', probeState: 'stale' }),
    pi: Object.freeze({ ...baselineRow, checkedCapability: 'rpc', authenticated: false }),
    jwc: Object.freeze({ ...baselineRow, path: null, checkedCapability: 'resident-engine' }),
    copilot: Object.freeze({ ...baselineRow, checkedCapability: 'acp' }),
    gemini: Object.freeze({ ...baselineRow, available: null, probeState: 'unknown', probeError: 'not checked' }),
});
const originalCache = structuredClone(cached);
const getCached = test.mock.fn(() => cached);
const getForced = test.mock.fn(() => cached);
test.mock.module('../../src/cli/cli-status.js', { namedExports: {
    getCachedCliStatus: getCached, getCachedCliStatusForced: getForced,
} });
test.mock.module('../../src/cli/cli-status-worker.js', { namedExports: {
    runCliStatusWorker: forbidden, collectCliStatus: forbidden, runCommand: forbidden,
} });
// The last native start failure is a live per-turn record, so the route reads it
// through this seam rather than from the cached probe snapshot (#658).
let startFailure: { code: string; at: number } | undefined;
const startFailures = await import('../../src/agent/runtime/start-failure.ts');
test.mock.module('../../src/agent/runtime/start-failure.js', { namedExports: { ...startFailures,
    nativeStartFailure: (cli: string) => (cli === 'cursor' ? startFailure : undefined),
} });
const { registerSettingsRoutes } = await import('../../src/routes/settings.ts');
const app = express();
registerSettingsRoutes(app, (_req, _res, next) => next(), async () => {
    throw new Error('read-only status route must not apply settings');
}, process.env['CLI_JAW_HOME']!);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert.ok(address && typeof address === 'object');
const base = `http://127.0.0.1:${address.port}`;
test.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
test.beforeEach(() => {
    getCached.mock.resetCalls();
    getForced.mock.resetCalls();
    forbidden.mock.resetCalls();
});

type StatusPayload = Record<string, CliStatusRow & {
    runtimeSelection?: { transport: string; nativeAdapterImplemented: boolean; nativeWorkerImplemented: boolean };
    lastStartFailure?: { code: string; at: number };
}>;
async function readStatus(query = ''): Promise<StatusPayload> {
    const response = await fetch(`${base}/api/cli-status${query}`);
    assert.equal(response.status, 200);
    const payload = await response.json() as StatusPayload;
    for (const cli of ['jwc', 'copilot', 'gemini']) {
        assert.deepEqual(payload[cli], originalCache[cli], `${cli} row must remain unchanged`);
        assert.equal(Object.hasOwn(payload[cli]!, 'runtimeSelection'), false,
            `${cli} is outside the transport selection diagnostic scope`);
    }
    return payload;
}

test('actual status route adds transport support without rewriting cached readiness/auth/probe evidence', async () => {
    const payload = await readStatus();
    assert.deepEqual(Object.keys(payload), Object.keys(cached));
    for (const cli of ['cursor', 'grok', 'claude']) {
        assert.deepEqual(payload[cli]?.runtimeSelection, {
            transport: 'native', nativeAdapterImplemented: true, nativeWorkerImplemented: cli === 'claude',
        }, cli);
    }
    for (const cli of ['codex-app', 'pi']) {
        assert.deepEqual(payload[cli]?.runtimeSelection, {
            transport: 'native', nativeAdapterImplemented: true, nativeWorkerImplemented: true,
        }, `${cli} builtin native does not become switchable`);
    }
    for (const [cli, row] of Object.entries(payload)) {
        const { runtimeSelection: _selection, ...preserved } = row;
        assert.deepEqual(preserved, originalCache[cli], `${cli} cached fields are preserved exactly`);
    }
    assert.deepEqual(cached, originalCache, 'shared cache has no added fields');
    assert.equal(getCached.mock.callCount(), 1);
    assert.equal(getForced.mock.callCount(), 0);
    assert.equal(forbidden.mock.callCount(), 0);
});

for (const [query, forced] of [['?force=1', true], ['?force=true', true], ['?force=0', false], ['?force=false', false]] as const) {
    test(`status ${query} calls only the appropriate cached getter once`, async () => {
        const payload = await readStatus(query);
        assert.equal(getForced.mock.callCount(), forced ? 1 : 0);
        assert.equal(getCached.mock.callCount(), forced ? 0 : 1);
        assert.deepEqual(payload['cursor']?.runtimeSelection, {
            transport: 'native', nativeAdapterImplemented: true, nativeWorkerImplemented: false,
        });
        assert.deepEqual(cached, originalCache);
        assert.equal(forbidden.mock.callCount(), 0, 'the route adds no capability probe');
    });
}

test('transport diagnostics follow settings changes without refreshing or mutating cached status', async () => {
    settings.perCli.cursor.transport = 'print';
    try {
        const payload = await readStatus();
        assert.deepEqual(payload['cursor']?.runtimeSelection, {
            transport: 'print', nativeAdapterImplemented: true, nativeWorkerImplemented: false,
        });
        assert.deepEqual(cached, originalCache);
        assert.equal(getCached.mock.callCount(), 1);
        assert.equal(getForced.mock.callCount(), 0);
        assert.equal(forbidden.mock.callCount(), 0);
    } finally {
        settings.perCli.cursor.transport = 'native';
    }
});

test('a recorded native start failure travels beside the cached row, never inside it', async () => {
    startFailure = { code: 'acp_config_unsupported_model', at: 1_700_000_000_000 };
    try {
        const payload = await readStatus();
        assert.deepEqual(payload['cursor']?.lastStartFailure, startFailure);
        // The compiled transport flags stay a closed shape: a live attempt is not
        // transport support, and readiness evidence is not a per-turn fault.
        assert.deepEqual(payload['cursor']?.runtimeSelection, {
            transport: 'native', nativeAdapterImplemented: true, nativeWorkerImplemented: false,
        });
        for (const [cli, row] of Object.entries(payload)) {
            const { runtimeSelection: _selection, lastStartFailure: _failure, ...preserved } = row;
            assert.deepEqual(preserved, originalCache[cli], `${cli} cached fields are preserved exactly`);
        }
        assert.deepEqual(cached, originalCache, 'shared cache has no added fields');
        // Only the runtime that failed carries the record.
        for (const cli of ['grok', 'claude', 'codex-app', 'pi']) {
            assert.equal(Object.hasOwn(payload[cli]!, 'lastStartFailure'), false, cli);
        }
    } finally {
        startFailure = undefined;
    }
});

test('no recorded failure means the key is absent rather than null', async () => {
    const payload = await readStatus();
    for (const row of Object.values(payload)) assert.equal(Object.hasOwn(row, 'lastStartFailure'), false);
});

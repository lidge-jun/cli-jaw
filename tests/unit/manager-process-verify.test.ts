import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPidAlive, resolveListeningPid, waitForPortFree } from '../../src/manager/process-verify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');
const processVerifySrc = readFileSync(join(projectRoot, 'src', 'manager', 'process-verify.ts'), 'utf8');
let fakeLsofQueue = Promise.resolve();
const LSOF_BIN_ENV = 'CLI_JAW_LSOF_BIN';

function withFakeLsof(script: string, fn: () => Promise<void>): () => Promise<void> {
    return async () => {
        const run = fakeLsofQueue.then(async () => {
            const dir = mkdtempSync(join(tmpdir(), 'jaw-lsof-stub-'));
            const binDir = join(dir, 'bin');
            mkdirSync(binDir);
            const lsofPath = join(binDir, 'lsof');
            writeFileSync(lsofPath, `#!/bin/sh\n${script}\n`);
            chmodSync(lsofPath, 0o755);
            const originalLsofBin = process.env[LSOF_BIN_ENV];
            process.env[LSOF_BIN_ENV] = lsofPath;
            try {
                await fn();
            } finally {
                if (originalLsofBin === undefined) delete process.env[LSOF_BIN_ENV];
                else process.env[LSOF_BIN_ENV] = originalLsofBin;
                rmSync(dir, { recursive: true, force: true });
            }
        });
        fakeLsofQueue = run.catch(() => undefined);
        await run;
    };
}

test('isPidAlive returns true for the current process', () => {
    assert.equal(isPidAlive(process.pid), true);
});

test('isPidAlive returns false for invalid pids', () => {
    assert.equal(isPidAlive(0), false);
    assert.equal(isPidAlive(-1), false);
    assert.equal(isPidAlive(1.5), false);
    assert.equal(isPidAlive(NaN), false);
});

test('isPidAlive returns false for a definitely-dead pid', () => {
    // pick a high pid that is extremely unlikely to exist
    assert.equal(isPidAlive(987654321), false);
});

test('waitForPortFree returns true when port is already free', async () => {
    const ok = await waitForPortFree(0, 200, { isPortOccupied: async () => false });
    assert.equal(ok, true);
});

test('waitForPortFree returns true after port becomes free during polling', async () => {
    let calls = 0;
    const ok = await waitForPortFree(0, 1000, {
        isPortOccupied: async () => {
            calls += 1;
            return calls < 3;
        },
    });
    assert.equal(ok, true);
    assert.ok(calls >= 3);
});

test('waitForPortFree returns false on timeout when port stays occupied', async () => {
    const ok = await waitForPortFree(0, 250, { isPortOccupied: async () => true });
    assert.equal(ok, false);
});

test('resolveListeningPid returns null for invalid port', async () => {
    assert.equal(await resolveListeningPid(0), null);
    assert.equal(await resolveListeningPid(-1), null);
    assert.equal(await resolveListeningPid(70000), null);
    assert.equal(await resolveListeningPid(1.5), null);
});

test('resolveListeningPid has a Windows netstat backend instead of lsof-only lookup', () => {
    assert.ok(
        processVerifySrc.includes("process.platform === 'win32'"),
        'Windows must not use the lsof-only PID lookup path',
    );
    assert.ok(
        processVerifySrc.includes("'netstat'"),
        'Windows should resolve listening PIDs through netstat',
    );
    assert.ok(
        processVerifySrc.includes("['-ano', '-p', 'tcp']"),
        'Windows netstat lookup should request PID columns for TCP listeners',
    );
});

test(
    'resolveListeningPid parses single pNNN line as the owning pid',
    withFakeLsof('echo p12345', async () => {
        assert.equal(await resolveListeningPid(3457), 12345);
    }),
);

test(
    'resolveListeningPid returns null when lsof prints zero pid lines',
    withFakeLsof('echo "no listeners"', async () => {
        assert.equal(await resolveListeningPid(3457), null);
    }),
);

test(
    'resolveListeningPid returns null when lsof prints multiple pid lines',
    withFakeLsof('printf "p11111\\np22222\\n"', async () => {
        assert.equal(await resolveListeningPid(3457), null);
    }),
);

test(
    'resolveListeningPid returns null when lsof exits non-zero',
    withFakeLsof('echo "lsof: bad" 1>&2; exit 1', async () => {
        assert.equal(await resolveListeningPid(3457), null);
    }),
);

test(
    'resolveListeningPid ignores non-conforming pid lines',
    withFakeLsof('printf "garbage\\np987\\nfNN\\n"', async () => {
        assert.equal(await resolveListeningPid(3457), 987);
    }),
);

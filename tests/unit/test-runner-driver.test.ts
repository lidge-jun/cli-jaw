// #661: tests/run.mts reported a file as fully passing while discarding the tests that
// file registered after a top-level await. The cause was run({forceExit:true}), which
// hands every child --test-force-exit; the child then exits as soon as its root test has
// drained the tests it already knows about, so a second wave of registrations executes
// uncounted. These run the real driver in a child, because the bug was invisible to
// every in-process assertion — the tests DID run, they just never got reported.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(import.meta.dirname, '..', '..');
const driverPath = join(projectRoot, 'tests', 'run.mts');
const fixture = (name: string) => join(projectRoot, 'tests', 'fixtures', 'test-runner', name);

function runDriver(args: string[], env: Record<string, string> = {}): { output: string; status: number | null } {
    // '--import tsx', not node_modules/.bin/tsx: that path is a POSIX shell wrapper under
    // some installer layouts and node dies on it before any test code runs (#521).
    // The driver under test is itself running inside a node:test child, which sets
    // NODE_TEST_CONTEXT/NODE_TEST_WORKER_ID. Inheriting those makes the nested run()
    // refuse to execute anything ("run() is being called recursively"), so the child
    // has to start from a clean test context.
    const inherited: Record<string, string | undefined> = { ...process.env };
    delete inherited['NODE_TEST_CONTEXT'];
    delete inherited['NODE_TEST_WORKER_ID'];
    const result = spawnSync(process.execPath, ['--import', 'tsx', driverPath, ...args], {
        cwd: projectRoot, encoding: 'utf8', timeout: 120_000,
        env: { ...inherited, ...env },
    });
    return { output: `${result.stdout ?? ''}${result.stderr ?? ''}`, status: result.status };
}

test('DRIVER-001: tests registered after a top-level await are reported, not silently dropped', { timeout: 120_000 }, () => {
    const { output, status } = runDriver([fixture('late-registration.fixture.ts')]);
    for (const name of ['LATE-A registered before the await', 'LATE-B registered after the await', 'LATE-C registered after the await']) {
        assert.ok(output.includes(name), `driver never reported "${name}":\n${output}`);
    }
    assert.match(output, /tests 3\b/, `driver did not count all three tests:\n${output}`);
    assert.equal(status, 0, output);
});

test('DRIVER-002: a file that stalls after its tests is named and fails the run', { timeout: 120_000 }, () => {
    const started = Date.now();
    const { output, status } = runDriver([fixture('stalled.fixture.ts')], { JAW_TEST_FILE_STALL_MS: '1500' });
    assert.notEqual(status, 0, `a stalled file must fail the run:\n${output}`);
    assert.ok(output.includes('no progress for 1500ms'), `the stall was not reported:\n${output}`);
    assert.ok(output.includes('stalled.fixture.ts'), `the stalled file was not named:\n${output}`);
    assert.ok(Date.now() - started < 60_000, 'the watchdog did not bound the run');
});

test('DRIVER-003: the driver never re-enables node:test forceExit', () => {
    const source = readFileSync(driverPath, 'utf8');
    assert.doesNotMatch(source, /forceExit\s*:/,
        'forceExit reintroduces #661 — see tests/fixtures/test-runner/late-registration.fixture.ts');
});
test('DRIVER-004: a finished file is never re-flagged while the rest of the run continues', { timeout: 120_000 }, () => {
    // The watchdog has to survive a run that outlives its own bound. stdout-tail finishes
    // immediately and then writes on exit; paced keeps the run going for ~4s. With a 2s
    // bound, any file left under watch after it reported would abort this run.
    const { output, status } = runDriver(
        [fixture('stdout-tail.fixture.ts'), fixture('paced.fixture.ts')],
        { JAW_TEST_FILE_STALL_MS: '2000' },
    );
    assert.ok(!output.includes('no progress for'), `the watchdog fired on a healthy run:\n${output}`);
    assert.match(output, /tests 11\b/, output);
    assert.equal(status, 0, output);
});

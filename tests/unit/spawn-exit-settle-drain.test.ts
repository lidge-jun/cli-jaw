import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// Regression for 1f6641ff30, which changed ten lines of spawn.ts and shipped with no
// test. An unref'd timeout does not keep the event loop alive, so when the barrier was
// armed and never settled, the loop drained, the timer never fired, and the race never
// resolved — "Promise resolution is still pending". The comment left behind explains
// the bug but cannot stop it being reintroduced.
//
// Fake timers cannot catch this. They fire unref'd timers happily; the failure is about
// process LIFETIME, which only a real process exhibits. So the check is a child that
// imports the barrier alone, waits on it, and prints a sentinel. With the timer
// referenced the child prints and exits 0. With unref() restored it exits silently.
//
// Importing the leaf is what makes this affordable: before the barrier was extracted
// it lived in spawn.ts, and a child would have had to load the whole server graph.

const __dirname = dirname(fileURLToPath(import.meta.url));
const moduleUrl = pathToFileURL(join(__dirname, '../../src/agent/spawn/exit-settle.ts')).href;

function runChild(body: string) {
    const started = Date.now();
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
        `import { armExitSettle, settleExit, waitForExitSettled } from '${moduleUrl}';\n${body}`,
    ], { encoding: 'utf8', timeout: 30_000 });
    return { ...child, elapsed: Date.now() - started };
}

test('ES-001: an armed, never-settled barrier still releases its waiter before the process exits',
    { timeout: 40_000 }, () => {
        const child = runChild([
            "armExitSettle('drain');",
            // Nothing else is scheduled. The timeout is the only handle holding this
            // process open, which is exactly the condition 1f6641ff30 hit.
            "await waitForExitSettled('drain', 400);",
            "process.stdout.write('SETTLED');",
        ].join('\n'));

        assert.equal(child.status, 0, `child failed: ${child.stderr}`);
        assert.match(child.stdout, /SETTLED/,
            'the waiter must resolve; an unref\'d timeout would let the drained loop exit silently');
        assert.ok(child.elapsed >= 350,
            `the waiter must actually wait out its timeout (elapsed ${child.elapsed}ms)`);
    });

test('ES-002: settling early releases the waiter without burning the timeout',
    { timeout: 40_000 }, () => {
        // The negative control: without it, ES-001 would also pass if waitForExitSettled
        // resolved immediately for the wrong reason.
        const child = runChild([
            "armExitSettle('drain');",
            "const waiter = waitForExitSettled('drain', 30000);",
            "settleExit('drain');",
            "await waiter;",
            "process.stdout.write('SETTLED');",
        ].join('\n'));

        assert.equal(child.status, 0, `child failed: ${child.stderr}`);
        assert.match(child.stdout, /SETTLED/);
        assert.ok(child.elapsed < 25_000,
            'a settled barrier must not hold the process for the full timeout');
    });

test('ES-003: an unarmed scope resolves without arming a timer at all',
    { timeout: 40_000 }, () => {
        const child = runChild([
            "await waitForExitSettled('never-armed', 30000);",
            "process.stdout.write('SETTLED');",
        ].join('\n'));

        assert.equal(child.status, 0, `child failed: ${child.stderr}`);
        assert.match(child.stdout, /SETTLED/);
        assert.ok(child.elapsed < 25_000, 'no arm means no wait');
    });

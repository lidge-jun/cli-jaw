// Programmatic node:test runner.
//
// Why: `tsx --test` (tsx 4.21 + node 24.x) triggers "node:test run() called
// recursively" and produces ZERO output (even a trivial zero-import test). A
// programmatic node:test run() from plain tsx (no --test flag) avoids that.
//
//   tsx --experimental-test-module-mocks tests/run.mts [--all|--scope root,unit|<paths...>] [--shard i/N] [--list] [--watch]
// --experimental-test-module-mocks must stay a node flag so mock.module works.
//
// Scopes: root (tests/*.test.ts), unit (tests/unit/*.test.ts) — both flat — and
// integration/manager/browser/bin (recursive under tests/<scope>/). Default is
// root,unit, which is what `npm test` has always meant. --shard i/N keeps the
// sorted-round-robin slice i of the selected files (see tests/setup/shard.ts);
// --list prints the selection and exits without running.
//
// isolation:'process' runs each file in its own subprocess (matching the old
// `--test` default). This keeps real-process/timing tests (bgtask spawn, session
// probes) from contending in one shared event loop — in-process concurrency made
// them flaky.
//
// Every child re-imports setup/test-home.ts through the run() execArgv option, so
// each FILE gets its own fresh CLI_JAW_HOME and jaw.db. Without that, children
// inherit the parent's single home and two files can race the same first-open
// migration (SqliteError: duplicate column name) — a failure that only shows up
// when enough DB-touching files land in one batch, i.e. exactly what sharding
// changes. The old CI invocation (--import test-home.ts --test) had per-file homes
// for the same reason; this keeps that behavior inside the driver.
//
// Stall protection lives in this driver, NOT in forceExit (#661). run({forceExit})
// hands every child --test-force-exit, and a child carrying that flag exits the moment
// its root test has drained the tests it currently KNOWS about (node v24.17.0
// lib/internal/test_runner/test.js:1373, "all known tests and hooks have finished").
// A file that registers tests after a top-level await which yields to the macrotask
// queue is still evaluating at that moment: its remaining tests execute and print their
// side effects, but their pass/fail events are never reported and never reach the exit
// code. On dev that discarded between 4 and 62 root+unit tests per run — the exact set
// varies because it is a race — including a genuinely failing one. So progress is
// watched here instead: a file that has started reporting and then goes quiet for
// JAW_TEST_FILE_STALL_MS (default 3 minutes) is named, fails the run and aborts the
// remaining children. That is the attribution shard 3/4 of run 34138235928 never got
// when it went silent for 4.5 minutes after ~half its files finished and was killed by
// the step timeout. Watch mode opts out of the watchdog.
//
// Coverage: node:test only collects coverage when run() receives { coverage: true }
// (v22.10+); the --experimental-test-coverage flag alone is filtered out of the
// programmatic path, so it is bridged from execArgv here.
import './setup/test-home.ts';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { parseArgs, partitionFiles, type RunnerOptions } from './setup/shard.ts';

const TESTS_DIR = resolve(import.meta.dirname);
function list(dir: string, recursive: boolean): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) { if (recursive) out.push(...list(full, true)); }
        else if (e.name.endsWith('.test.ts')) out.push(full);
    }
    return out;
}
function collectFiles({ explicit, all, scopes }: RunnerOptions): string[] {
    if (explicit.length) return explicit.flatMap(p => {
        const absolute = resolve(p);
        return existsSync(absolute) && statSync(absolute).isDirectory() ? list(absolute, true) : [absolute];
    });
    if (all) return list(TESTS_DIR, true);
    const selected = scopes.length ? scopes : ['root', 'unit'];
    return selected.flatMap(scope => list(
        scope === 'root' ? TESTS_DIR : join(TESTS_DIR, scope),
        scope !== 'root' && scope !== 'unit',
    ));
}
let options: RunnerOptions;
let files: string[];
try {
    options = parseArgs(process.argv.slice(2));
    files = partitionFiles(collectFiles(options).map(p => p.split(sep).join('/')), options.shard);
} catch (error) {
    console.error(`[tests/run] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
const { watch, list: listOnly } = options;
if (files.length === 0) { console.error('[tests/run] no test files matched'); process.exit(1); }
if (listOnly) { for (const f of files) console.log(f); process.exit(0); }
const scopeLabel = options.explicit.length ? 'explicit' : options.all ? 'all' : (options.scopes.length ? options.scopes : ['root', 'unit']).join(',');
console.log(`[tests/run] ${files.length} files (scope=${scopeLabel}, shard=${options.shard ? `${options.shard.index}/${options.shard.total}` : 'none'})`);
const coverage = process.execArgv.includes('--experimental-test-coverage');
const execArgv = ['--import', pathToFileURL(join(TESTS_DIR, 'setup', 'test-home.ts')).href];
const override = Number(process.env['JAW_TEST_FILE_STALL_MS']);
const stallMs = Number.isFinite(override) && override >= 0 ? override : 180_000;
const controller = new AbortController();
// A file is watched from the first event its CHILD produces, not from the file's own
// dequeue: while ~500 children compete for cores a healthy file can sit 60s between
// being dequeued and producing anything (measured), but once its child is talking the
// worst observed gap between events is 9.5s and the gap from its last test to its own
// completion is 165ms. Silence past stallMs therefore means the child is wedged, which
// is exactly the failure forceExit was papering over. Paths are normalized on both
// sides because run() is handed '/'-joined names while node reports resolve()d ones,
// and on Windows those two differ; comparing them raw would leave every Windows run
// unwatched.
// A settled file is never re-armed: a child's buffered output can still reach the parent
// after that file's own completion event, and putting it back under watch would leave a
// finished file pinned until the bound expired.
const normalize = (path: string) => path.split('\\').join('/');
const declared = new Set(files.map(normalize));
const active = new Map<string, { at: number; last: string; events: number }>();
const settled = new Set<string>();
let failures = 0;
const stream = run({ files, concurrency: true, watch, isolation: 'process', coverage, execArgv, signal: controller.signal });
const keyOf = (event: { file?: string }) => typeof event.file === 'string' ? normalize(event.file) : undefined;
const isFileEntry = (event: { name?: string }) => typeof event.name === 'string' && declared.has(normalize(event.name));
const touch = (channel: string) => (event: { file?: string; name?: string }) => {
    const key = keyOf(event);
    if (key === undefined || settled.has(key) || isFileEntry(event)) return;
    active.set(key, { at: Date.now(), last: channel, events: (active.get(key)?.events ?? 0) + 1 });
};
const close = (key: string) => { settled.add(key); active.delete(key); };
const settle = (channel: string) => (event: { file?: string; name?: string }) => {
    const key = keyOf(event);
    if (key === undefined) return;
    if (isFileEntry(event)) close(key); else touch(channel)(event);
};
for (const channel of ['test:start', 'test:stdout', 'test:stderr', 'test:diagnostic', 'test:dequeue', 'test:enqueue']) stream.on(channel, touch(channel));
stream.on('test:pass', settle('test:pass'));
stream.on('test:complete', settle('test:complete'));
stream.on('test:fail', event => { failures += 1; settle('test:fail')(event); });
// The per-file summary is the other completion signal node emits under process
// isolation, and it carries only `file`; take it as settlement too.
stream.on('test:summary', event => { const key = keyOf(event); if (key !== undefined && declared.has(key)) close(key); });
let watchdog: ReturnType<typeof setInterval> | undefined;
if (!watch && stallMs > 0) watchdog = setInterval(() => {
    const now = Date.now();
    const stalled = [...active].filter(([, seen]) => now - seen.at >= stallMs);
    if (stalled.length === 0) return;
    clearInterval(watchdog);
    // Name what went quiet AND what it was doing, so a stall never has to be diagnosed
    // by re-running CI: the last channel and the event count separate "wedged mid-test"
    // from "produced one line and died".
    const detail = stalled.map(([file, seen]) => `  ${file} — last ${seen.last} ${now - seen.at}ms ago after ${seen.events} event(s)`).join('\n');
    console.error(`[tests/run] no progress for ${stallMs}ms (JAW_TEST_FILE_STALL_MS); aborting:\n${detail}`);
    process.exitCode = 1;
    controller.abort();
    // If the aborted stream cannot finish either, do not hand the shard back to the CI
    // step timeout with nothing to show for it.
    setTimeout(() => process.exit(1), 15_000).unref();
}, 1000).unref();
stream.compose(spec).pipe(process.stdout);
if (!watch) process.on('beforeExit', () => { clearInterval(watchdog); if (failures > 0 && !process.exitCode) process.exitCode = 1; });

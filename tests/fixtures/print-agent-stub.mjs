#!/usr/bin/env node
/**
 * Print-mode agent stand-in, installed on a server child's PATH under a real
 * CLI name (claude).
 *
 * Seam: spawnAgent resolves the binary by NAME off PATH (src/core/cli-detect.ts
 * detectCliBinary, src/agent/spawn.ts preflight). There is no settings field for
 * an absolute agent path and no CLAUDE_BIN env, so PATH is the whole mechanism.
 * Two consequences this file must respect:
 *   - isSpawnableCliFile rejects a text file with no shebang and no exec bit
 *     (src/core/cli-detect.ts), hence the shebang above and mode 0o755;
 *   - the Claude print argv carries NO prompt (src/agent/args.ts); the prompt
 *     arrives on stdin and the stream is ended, so this must drain stdin before
 *     it can decide anything.
 *
 * Mode comes from the LAST STUB_MODI:<mode>:<token> directive in the prompt:
 *   echo   answer with one assistant message and exit (default)
 *   empty  emit only the result line — the empty-terminal shape
 *   hold   stay alive until released or killed — makes a live pid, a steer and
 *          a scoped kill observable
 *
 * LAST, not first, and one directive rather than several independent markers:
 * the prompt carries the conversation history, so an earlier turn's directive is
 * still in the text. Matching the first occurrence made every turn replay turn
 * one's mode, which is a bug that reads as a product failure.
 *
 * Every wait is capped well under the tests/run.mts 180s per-file stall
 * watchdog, so a missed release fails one case with a message instead of
 * silently stalling the integration job.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HOLD_CAP_MS = 60_000;
const dir = process.env['JAW_STUB_DIR'] ?? '';
const recordPath = dir ? join(dir, process.pid + '.json') : '';

function record(extra) {
    if (!recordPath) return;
    try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(recordPath, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2), ...extra }, null, 2));
    } catch { /* the test asserts on the record; a write failure shows up there */ }
}

function note(line) {
    if (!dir) return;
    try { appendFileSync(join(dir, 'stub.log'), process.pid + ' ' + line + '\n'); } catch { /* best effort */ }
}

async function readPrompt() {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
}

function directive(prompt) {
    const hits = [...prompt.matchAll(/STUB_MODI:(echo|empty|hold):([A-Za-z0-9-]+)/g)];
    const last = hits.at(-1);
    return last ? { mode: last[1], token: last[2] } : { mode: 'echo', token: 'default' };
}

const prompt = await readPrompt();
record({ prompt, startedAt: new Date().toISOString() });
note('started');

const { mode, token: echo } = directive(prompt);
const empty = mode === 'empty';
const hold = mode === 'hold' ? echo : null;

function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function finish() {
    if (!empty) emit({ type: 'assistant', message: { id: 'stub-1', content: [{ type: 'text', text: 'stub reply ' + echo }] } });
    emit({ type: 'result', total_cost_usd: 0, num_turns: 1, duration_ms: 1 });
    process.exit(0);
}

if (hold === null) {
    finish();
} else {
    // A kill from the product must look like a normal terminated agent: record
    // that the signal arrived so the test can tell a real SIGTERM apart from a
    // process that merely vanished, then leave.
    for (const signal of ['SIGTERM', 'SIGINT']) {
        process.on(signal, () => {
            record({ prompt, terminatedAt: new Date().toISOString(), signal });
            note('terminated by ' + signal);
            process.exit(0);
        });
    }
    const release = dir ? join(dir, 'release-' + hold) : '';
    const started = Date.now();
    const tick = setInterval(() => {
        if (release && existsSync(release)) { clearInterval(tick); note('released'); finish(); return; }
        if (Date.now() - started >= HOLD_CAP_MS) {
            clearInterval(tick);
            note('hold cap reached');
            process.stderr.write('print-agent-stub: hold ' + hold + ' was never released within ' + HOLD_CAP_MS + 'ms\n');
            finish();
        }
    }, 50);
}

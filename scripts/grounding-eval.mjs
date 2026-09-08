#!/usr/bin/env node
/**
 * scripts/grounding-eval.mjs — run the grounding cases and report the rates.
 *
 * EXECUTION HOME, stated rather than assumed.
 *
 * This is an OPERATOR-RUN tool, not a CI check. It needs a live Chrome and a
 * codex spawn, and `test.yml` has no fixture that provides either. Adding one
 * would mean a model round-trip per case inside CI, which is slow, costs
 * money, and is non-deterministic in a place that must be neither.
 *
 * So the contract is: an operator runs it, and its output is recorded
 * evidence. That is a weaker guarantee than a gate, and saying so is the
 * point — the alternative was a harness that quietly ran nowhere.
 *
 *   cli-jaw serve                       # in another terminal
 *   node scripts/grounding-eval.mjs     # add --json to capture the report
 *
 * Exit status reflects the run, not a threshold: 0 when every case was
 * scored, 1 when any case errored. There is deliberately no pass/fail bar,
 * because a number invented before the first measurement is not a standard.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fixtureDir = path.join(root, 'tests/fixtures/grounding');

function parseArgs(argv) {
    const opts = { port: 9222, json: false, only: null, base: 'http://127.0.0.1:3457' };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--json') opts.json = true;
        else if (a === '--port') opts.port = Number(argv[++i]);
        else if (a === '--only') opts.only = String(argv[++i]);
        else if (a === '--base') opts.base = String(argv[++i]);
        else if (a === '--help' || a === '-h') opts.help = true;
    }
    return opts;
}

const usage = `grounding-eval — measure grounding on fixed local fixtures

  node scripts/grounding-eval.mjs [--port 9222] [--base http://127.0.0.1:3457]
                                  [--only <case-id>] [--json]

Requires a running cli-jaw server and a browser session. This is an
operator-run tool; its output is recorded evidence, not a gate.`;

async function api(base, method, route, body) {
    const res = await fetch(base + route, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) }; }
    catch { return { status: res.status, body: { raw: text } }; }
}

/** Which element ended up focused or activated, so a click can be scored. */
const CLICK_WITNESS = `(() => {
    const el = window.__lastClickTarget;
    return el && el.id ? el.id : null;
})()`;

const INSTALL_WITNESS = `(() => {
    window.__lastClickTarget = null;
    document.addEventListener('click', (e) => { window.__lastClickTarget = e.target; }, true);
    return true;
})()`;

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { console.log(usage); return 0; }

    const { scoreRun, classify, formatReport } = await import('../src/browser/grounding-eval.ts');
    const spec = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'cases.json'), 'utf8'));
    const fixtureUrl = 'file://' + path.join(fixtureDir, spec.fixture);
    const cases = opts.only ? spec.cases.filter(c => c.id === opts.only) : spec.cases;

    const results = [];
    for (const c of cases) {
        const started = Date.now();
        try {
            await api(opts.base, 'POST', '/api/browser/navigate', { url: fixtureUrl });
            // Record what actually receives the click, since "success" alone
            // cannot distinguish a correct click from a wrong one.
            await api(opts.base, 'POST', '/api/browser/evaluate', { script: INSTALL_WITNESS });

            const res = await api(opts.base, 'POST', '/api/browser/vision-click', { target: c.target });
            const witness = await api(opts.base, 'POST', '/api/browser/evaluate', { script: CLICK_WITNESS });
            const clicked = witness.body?.result ?? null;
            const ms = Date.now() - started;

            // A case that declares abstention correct is scored inverted: an
            // abstention is the right answer, and a confident click is not.
            if (c.expectAbstention) {
                const outcome = res.body?.success === true
                    ? { kind: 'misclick', ms, got: clicked ?? 'unknown' }
                    : { kind: 'verified', ms };
                results.push({ id: c.id, expected: 'abstain', outcome });
                continue;
            }

            results.push({
                id: c.id,
                expected: c.expected ?? 'coordinate',
                outcome: classify(res.body ?? {}, c.expected ?? 'coordinate', ms, clicked ?? undefined),
            });
        } catch (err) {
            results.push({
                id: c.id,
                expected: c.expected ?? 'coordinate',
                outcome: { kind: 'errored', ms: Date.now() - started, error: String(err?.message ?? err) },
            });
        }
    }

    const report = scoreRun(results);
    if (opts.json) {
        console.log(JSON.stringify({ report, results }, null, 2));
    } else {
        for (const r of results) {
            const o = r.outcome;
            const detail = o.kind === 'misclick' ? ` (got ${o.got}, wanted ${r.expected})`
                : o.kind === 'abstained' ? ` (${o.reason})`
                : o.kind === 'errored' ? ` (${o.error})`
                : '';
            console.log(`${o.kind.padEnd(10)} ${r.id}${detail}`);
        }
        console.log('');
        console.log(formatReport(report));
    }
    return report.errored > 0 ? 1 : 0;
}

main().then(code => process.exit(code)).catch(err => {
    console.error('grounding-eval failed:', err?.message ?? err);
    process.exit(1);
});


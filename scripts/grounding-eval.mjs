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
    const opts = { port: null, json: false, only: null, base: 'http://127.0.0.1:3457' };
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

async function api(base, method, route, body, port) {
    // The route resolves the CDP port from the query string, so an operator
    // targeting a specific Chrome needs it forwarded. It used to be parsed and
    // then ignored, which silently ran against whatever port was active.
    const url = base + route + (port ? `?port=${port}` : '');
    const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) }; }
    catch { return { status: res.status, body: { raw: text } }; }
}

/**
 * Record what the page actually received, so a click can be scored against
 * reality rather than against the response's own claim.
 *
 * The listener walks UP from the event target to the nearest element with an
 * id. A click on a button's inner span reports the span otherwise, and the
 * harness would score a correct click as a misclick - measuring its own
 * instrumentation rather than the pipeline.
 *
 * Reinstalled per case, since navigation discards it.
 */
const INSTALL_WITNESS = `(() => {
    window.__jawClickedId = null;
    document.addEventListener('click', (e) => {
        let node = e.target;
        for (let i = 0; node && i < 24; i++) {
            if (node.id) { window.__jawClickedId = node.id; return; }
            node = node.parentElement;
        }
        window.__jawClickedId = null;
    }, true);
    return true;
})()`;

const CLICK_WITNESS = 'window.__jawClickedId';

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { console.log(usage); return 0; }

    const { scoreRun, classify, classifyFailure, formatReport } = await import('../src/browser/grounding-eval.ts');
    const spec = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'cases.json'), 'utf8'));
    const fixtureUrl = 'file://' + path.join(fixtureDir, spec.fixture);
    const cases = opts.only ? spec.cases.filter(c => c.id === opts.only) : spec.cases;

    const results = [];
    for (const c of cases) {
        const started = Date.now();
        try {
            const nav = await api(opts.base, 'POST', '/api/browser/navigate', { url: fixtureUrl }, opts.port);
            // A failed navigation would score the whole case against whatever
            // page happened to be loaded, which is worse than not scoring it.
            if (nav.status >= 400) throw new Error(`navigate failed (${nav.status}): ${nav.body?.error ?? ''}`);

            // Record what actually receives the click, since "success" alone
            // cannot distinguish a correct click from a wrong one.
            const install = await api(opts.base, 'POST', '/api/browser/evaluate', { expression: INSTALL_WITNESS }, opts.port);
            if (install.status >= 400) throw new Error(`witness install failed (${install.status})`);

            const res = await api(opts.base, 'POST', '/api/browser/vision-click', { target: c.target }, opts.port);
            const witness = await api(opts.base, 'POST', '/api/browser/evaluate', { expression: CLICK_WITNESS }, opts.port);
            const clicked = witness.body?.result ?? null;
            const ms = Date.now() - started;

            // A case that declares abstention correct is scored inverted: an
            // abstention is the right answer, and a confident click is not.
            //
            // But a REFUSAL and a FAILURE are not the same thing. Scoring an
            // HTTP error or a crashed call as "correctly declined" would turn
            // harness breakage into a good result — the one direction an
            // evaluation must never fail. Only a real refusal counts.
            //
            // That was the intent; the predicate below did not honour it. It
            // asked whether a code or a reason was PRESENT, so a capture that
            // could not be measured scored as the occlusion guard firing
            // correctly — on the very cases that exist as evidence for those
            // guards. It now asks what the code MEANS, through the same
            // classifier the CLI and the scorer use.
            //
            // `classifyFailure`, not `classify`: this site needs a predicate.
            // `classify` would return `abstained` for a correct refusal, which
            // `scoreRun` files as `refusal.abstained` with `refusal.verified`
            // at zero — reporting "0/3 correctly declined" for perfect work.
            if (c.expectAbstention) {
                if (res.status >= 400) {
                    results.push({ id: c.id, expected: 'abstain', outcome: { kind: 'errored', ms, error: `HTTP ${res.status}` } });
                    continue;
                }
                const kind = res.body?.success === false ? classifyFailure(res.body?.code) : null;
                const outcome = res.body?.success === true
                    ? { kind: 'misclick', ms, got: clicked ?? 'unknown' }
                    : kind === 'abstention' || kind === 'not-found'
                        // Declining because the target was ambiguous, covered,
                        // stale, or simply absent are all correct answers on a
                        // case whose right answer is to decline.
                        ? { kind: 'verified', ms }
                        : kind === 'grounding-failure'
                            ? { kind: 'grounding-failure', ms, reason: res.body?.code }
                            : { kind: 'errored', ms, error: res.body?.code ?? res.body?.reason ?? 'declined without a reason' };
                results.push({ id: c.id, expected: 'abstain', outcome });
                continue;
            }

            // A case with no DOM target expects a coordinate click. It cannot
            // be scored by element identity — the witness reports whatever the
            // coordinate landed on — so it is scored by landing INSIDE the
            // named region instead.
            if (c.expectRegion) {
                // This branch had no status check at all, so a 500 from the
                // route's catch — `{error}`, no `success` field — scored as a
                // decline and exited 0. And its `?? 'declined'` fallback
                // manufactured a reason where `classify` would have said none
                // was given, making it strictly more permissive than the
                // function it stood beside.
                if (res.status >= 400) {
                    results.push({ id: c.id, expected: c.expectRegion, outcome: { kind: 'errored', ms, error: `HTTP ${res.status}` } });
                    continue;
                }
                const outcome = res.body?.success !== true
                    ? classify(res.body ?? {}, c.expectRegion, ms)
                    : clicked === c.expectRegion
                        ? { kind: 'verified', ms }
                        : { kind: 'misclick', ms, got: clicked ?? 'unknown' };
                results.push({ id: c.id, expected: c.expectRegion, outcome });
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
                // A thrown refusal-expected case belongs in the refusal
                // bucket. It files as an error either way today, but the
                // bucket is read from `expected`, so getting it wrong here
                // would put it in the wrong group the moment that changes.
                expected: c.expectAbstention ? 'abstain' : (c.expectRegion ?? c.expected ?? 'coordinate'),
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

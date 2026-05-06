#!/usr/bin/env node
/**
 * Phase 22 named release gates for cli-jaw.
 *
 * Each gate has a NAME, a CHECK function, and prints PASS / FAIL.
 * Usage:
 *   node scripts/release-gates.mjs              # run all gates
 *   node scripts/release-gates.mjs <gate-name>  # run one gate
 *
 * Wired through package.json as `gate:<name>`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditClaims, formatClaimAuditReport } from './claim-audit.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, opts = {}) {
    return spawnSync(cmd, args, {
        cwd: repoRoot,
        stdio: opts.stdio || 'pipe',
        encoding: 'utf8',
        ...opts,
    });
}

function readFile(rel) {
    return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

const FORBIDDEN_IN_READY = [
    /external[-\s]?cdp/i,
    /remote[-\s]?cdp/i,
    /hosted browser/i,
    /browser_type_ref/,
    /browser_navigate/,
    /browser_screenshot/,
    /browser_back/,
    /browser_forward/,
    /browser_reload/,
    /browser_wait_for/,
    /browser_extract_text/,
];

const GATES = {
    'typecheck': {
        description: 'tsc --noEmit (server + frontend) clean',
        check() {
            const tasks = ['typecheck', 'typecheck:frontend'];
            for (const t of tasks) {
                const r = run('npm', ['run', t, '--silent']);
                if (r.status !== 0) {
                    return { ok: false, detail: `${t} failed:\n${(r.stderr || r.stdout || '').slice(-2000)}` };
                }
            }
            return { ok: true, detail: `tsc clean for: ${tasks.join(', ')}` };
        },
    },
    'tests': {
        description: 'browser web-ai unit tests pass (mirror parity)',
        check() {
            const targets = [
                'tests/unit/browser-web-ai-target-resolver.test.ts',
                'tests/unit/browser-web-ai-answer-artifact.test.ts',
                'tests/unit/browser-web-ai-source-audit.test.ts',
                'tests/unit/browser-web-ai-cli-contract.test.ts',
                'tests/unit/release-gates.test.ts',
            ].filter((p) => fs.existsSync(path.join(repoRoot, p)));
            if (targets.length === 0) {
                return { ok: false, detail: 'no Phase 22 mirror tests found' };
            }
            const args = [
                'tsx', '--import', './tests/setup/test-home.ts',
                '--experimental-test-module-mocks', '--test',
                ...targets,
            ];
            const r = run('npx', args);
            if (r.status !== 0) {
                return { ok: false, detail: `tests failed:\n${(r.stdout || r.stderr || '').slice(-2000)}` };
            }
            return { ok: true, detail: `passed ${targets.length} suite(s): ${targets.join(', ')}` };
        },
    },
    'truth-table-fresh': {
        description: 'CAPABILITY_TRUTH_TABLE.md edited within 7 days OR matches code refs',
        check() {
            const rel = 'structure/CAPABILITY_TRUTH_TABLE.md';
            const abs = path.join(repoRoot, rel);
            if (!fs.existsSync(abs)) return { ok: false, detail: `${rel} missing` };
            const stat = fs.statSync(abs);
            const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
            if (ageDays <= 7) return { ok: true, detail: `truth table ${ageDays.toFixed(2)}d old` };
            const text = readFile(rel);
            const required = ['action-intent', 'target-resolver', 'answer-artifact', 'source-audit'];
            for (const term of required) {
                if (!text.includes(term)) {
                    return { ok: false, detail: `truth table stale (${ageDays.toFixed(1)}d) and missing ${term}` };
                }
            }
            return { ok: true, detail: `truth table ${ageDays.toFixed(1)}d old but matches required terms` };
        },
    },
    'mcp-scope-frozen': {
        description: 'cli-jaw exposes no browser MCP tool surface (agbrowse owns 2 frozen tools)',
        check() {
            // cli-jaw must NOT register browser_* MCP tools — agbrowse is the
            // sole source. Scan src/ for any new declarative MCP tool entries
            // named browser_*.
            const offenders = [];
            const srcDir = path.join(repoRoot, 'src');
            const stack = [srcDir];
            while (stack.length) {
                const dir = stack.pop();
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        stack.push(full);
                        continue;
                    }
                    if (!/\.(ts|mts|mjs|js|cjs)$/.test(entry.name)) continue;
                    const text = fs.readFileSync(full, 'utf8');
                    // any hint of a registered MCP browser_* tool definition
                    if (/['"]browser_(snapshot|click_ref|type_ref|navigate|back|forward|reload|wait_for|screenshot|extract_text)['"]\s*:\s*{/.test(text)) {
                        offenders.push(path.relative(repoRoot, full));
                    }
                }
            }
            if (offenders.length > 0) {
                return { ok: false, detail: `cli-jaw must not register browser MCP tools; offenders:\n${offenders.join('\n')}` };
            }
            return { ok: true, detail: 'cli-jaw registers no browser MCP tools (agbrowse owns the frozen scope)' };
        },
    },
    'no-experimental-in-readme-ready-section': {
        description: 'README "ready" claims do not include external CDP or unimplemented MCP tools',
        check() {
            const files = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md', 'structure/CAPABILITY_TRUTH_TABLE.md']
                .filter((p) => fs.existsSync(path.join(repoRoot, p)));
            const offending = [];
            for (const rel of files) {
                const text = readFile(rel);
                const sections = text.split(/\n##\s+/);
                for (const sec of sections) {
                    const head = sec.split('\n', 1)[0].toLowerCase();
                    const isReady = head.includes('ready') || head.includes('production') || head.includes('supported') || head.includes('feature');
                    const isExperimentalSection = head.includes('experimental') || head.includes('deferred') || head.includes('out of scope') || head.includes('forbidden') || head.includes('mirror rules');
                    if (!isReady || isExperimentalSection) continue;
                    for (const pat of FORBIDDEN_IN_READY) {
                        if (pat.test(sec)) {
                            offending.push(`${rel} :: ${head} :: ${pat}`);
                        }
                    }
                }
            }
            if (offending.length > 0) {
                return { ok: false, detail: `forbidden terms in ready sections:\n${offending.join('\n')}` };
            }
            return { ok: true, detail: `${files.length} README/truth-table file(s) clean of experimental terms in ready sections` };
        },
    },
    'no-cloud-claims': {
        description: 'no hosted/cloud/stealth/external-CDP/leaderboard claims outside experimental sections (G10 mirror)',
        check() {
            const report = auditClaims({ repoRoot });
            return { ok: report.ok, detail: formatClaimAuditReport(report) };
        },
    },
    'observe-actions-fixtures': {
        description: 'observe-actions module loads and produces ranked candidates from a fixture snapshot (G02 mirror)',
        async check() {
            try {
                const { spawnSync } = await import('node:child_process');
                const path = await import('node:path');
                const tsxBin = path.resolve(repoRoot, 'node_modules/.bin/tsx');
                const fixtureScript = `import { buildObserveActions, formatObserveActions } from '${path.resolve(repoRoot, 'src/browser/web-ai/observe-actions.ts').replace(/\\\\/g, '/')}';\nconst r = buildObserveActions({ snapshotId: 'gate-fixture', url: null, refs: { '@e1': { role: 'button', name: 'Sign in' }, '@e2': { role: 'textbox', name: 'Email' }, '@e3': { role: 'link', name: 'Forgot password?' } } }, 'click sign in');\nif (!r || !Array.isArray(r.candidates) || r.candidates.length < 3) { console.error('candidates<3'); process.exit(2); }\nif (r.candidates[0].ref !== '@e1' || r.candidates[0].action !== 'click') { console.error('rank-fail'); process.exit(3); }\nif (!r.candidates.every(c => c.args.snapshotId === 'gate-fixture')) { console.error('snapId-missing'); process.exit(4); }\nconst t = formatObserveActions(r); if (!t || typeof t !== 'string') { console.error('format-fail'); process.exit(5); }\nconsole.log('OK ' + r.candidates.length);`;
                const res = spawnSync(tsxBin, ['--eval', fixtureScript], { encoding: 'utf8' });
                if (res.status !== 0) {
                    return { ok: false, detail: `observe-actions fixture failed: status=${res.status} stderr=${(res.stderr || '').trim()} stdout=${(res.stdout || '').trim()}` };
                }
                return { ok: true, detail: `observe-actions fixture: ${(res.stdout || '').trim()}` };
            } catch (err) {
                return { ok: false, detail: `observe-actions fixture threw: ${(err && err.message) || err}` };
            }
        },
    },
};

function printResult(name, result) {
    const status = result.ok ? 'PASS' : 'FAIL';
    process.stdout.write(`[${status}] gate:${name} — ${GATES[name].description}\n`);
    if (result.detail) process.stdout.write(`        ${result.detail.replace(/\n/g, '\n        ')}\n`);
}

async function main() {
    const target = process.argv[2];
    const names = target ? [target] : Object.keys(GATES);
    let failed = 0;
    for (const name of names) {
        if (!GATES[name]) {
            process.stdout.write(`[FAIL] gate:${name} — unknown gate\n`);
            failed += 1;
            continue;
        }
        let result;
        try {
            result = await GATES[name].check();
        } catch (err) {
            result = { ok: false, detail: `threw: ${err.message}` };
        }
        printResult(name, result);
        if (!result.ok) failed += 1;
    }
    process.stdout.write(failed === 0 ? `\nAll ${names.length} gate(s) passed.\n` : `\n${failed}/${names.length} gate(s) FAILED.\n`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
    process.stderr.write(`release-gates threw: ${err.stack || err}\n`);
    process.exit(1);
});

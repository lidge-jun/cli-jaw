import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const gateScript = path.join(repoRoot, 'scripts', 'release-gates.mjs');
const truthTablePath = path.join(repoRoot, 'structure/CAPABILITY_TRUTH_TABLE.md');
const GENERATED_START = '<!-- BEGIN GENERATED: messaging-channel-capabilities -->';
const GENERATED_END = '<!-- END GENERATED: messaging-channel-capabilities -->';

function runGate(name: string): { status: number; stdout: string; stderr: string } {
    const r = spawnSync('node', [gateScript, name], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function runGenerator(...args: string[]): { status: number; stdout: string; stderr: string } {
    // tsx's dist/cli.mjs under the current node, not npx and not the .bin
    // shim: the gate resolves it the same way, a test that used npx would
    // pass while the gate failed offline, and node_modules/.bin/tsx is a bash
    // script Windows cannot execute (spawnSync returned status null there).
    const r = spawnSync(process.execPath, [
        path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs'),
        'scripts/generate-channel-capability-table.mts',
        ...args,
    ], { cwd: repoRoot, encoding: 'utf8' });
    return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('phase22 named release gates (cli-jaw)', () => {
    it('release-gates.mjs exists and is executable as a script', () => {
        assert.ok(fs.existsSync(gateScript), 'scripts/release-gates.mjs must exist');
    });

    it('truth-table-fresh gate passes', () => {
        const r = runGate('truth-table-fresh');
        assert.equal(r.status, 0, `expected pass, got: ${r.stdout}\n${r.stderr}`);
        assert.match(r.stdout, /\[PASS\] gate:truth-table-fresh/);
    });

    it('mcp-scope-frozen gate passes (cli-jaw exposes no browser MCP tools)', () => {
        const r = runGate('mcp-scope-frozen');
        assert.equal(r.status, 0, `expected pass, got: ${r.stdout}\n${r.stderr}`);
        assert.match(r.stdout, /\[PASS\] gate:mcp-scope-frozen/);
    });

    it('no-experimental-in-readme-ready-section gate passes', () => {
        const r = runGate('no-experimental-in-readme-ready-section');
        assert.equal(r.status, 0, `expected pass, got: ${r.stdout}\n${r.stderr}`);
        assert.match(r.stdout, /\[PASS\] gate:no-experimental-in-readme-ready-section/);
    });

    it('unknown gate name fails fast', () => {
        const r = runGate('definitely-not-a-real-gate');
        assert.notEqual(r.status, 0);
        assert.match(r.stdout, /unknown gate/);
    });

    // The #660 merge committed 14 unresolved conflict blocks to dev and every
    // check stayed green, because doc-drift — the only gate that reads these
    // files' contents — returns PASS immediately when CI is set. So the scan
    // has to be proven to run WITH CI set, and proven to actually fail.
    function runGateOnCi(cwd: string, script: string) {
        return spawnSync(process.execPath, [script, 'doc-drift'], {
            cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
        });
    }

    it('doc-drift scans for conflict markers even when CI is set', () => {
        const r = runGateOnCi(repoRoot, gateScript);
        assert.equal(r.status, 0, 'expected pass, got: ' + r.stdout + '\n' + r.stderr);
        assert.match(r.stdout ?? '', /conflict-marker scan clean/);
    });

    it('doc-drift fails on a tracked conflict marker under CI', () => {
        // The gate derives its repo root from its own path, so a copy inside a
        // throwaway git repo scans THAT repo. That is the only way to prove the
        // failure path without committing a marker into this one.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-jaw-conflict-gate-'));
        try {
            fs.mkdirSync(path.join(tmp, 'scripts'));
            for (const file of ['release-gates.mjs', 'claim-audit.mjs']) {
                fs.copyFileSync(path.join(repoRoot, 'scripts', file), path.join(tmp, 'scripts', file));
            }
            const git = (...args: string[]) => spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
            git('init', '-q');
            git('config', 'user.email', 'gate-test@example.invalid');
            git('config', 'user.name', 'gate test');
            fs.writeFileSync(path.join(tmp, 'doc.md'), [
                'intro',
                '<<<<<<< HEAD',
                'ours',
                '=======',
                'theirs',
                '>>>>>>> other-branch',
                '',
            ].join('\n'));
            git('add', '-A');
            git('commit', '-qm', 'planted');
            const r = runGateOnCi(tmp, path.join(tmp, 'scripts', 'release-gates.mjs'));
            assert.notEqual(r.status, 0, 'expected FAIL, got: ' + r.stdout + '\n' + r.stderr);
            assert.match(r.stdout ?? '', /unresolved conflict marker line/);
            assert.match(r.stdout ?? '', /doc\.md:2/);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('doc-drift ignores the intentional wysiwyg conflict fixtures', () => {
        const fixture = path.join(repoRoot, 'tests/fixtures/manager-notes-wysiwyg/conflict-local-remote.input.md');
        assert.ok(fs.existsSync(fixture), 'the excluded fixture must still exist');
        assert.match(fs.readFileSync(fixture, 'utf8'), /^<<<<<<< /m,
            'the fixture must still carry a marker, or the exclusion is untested');
        const r = runGateOnCi(repoRoot, gateScript);
        assert.equal(r.status, 0, 'fixtures must not fail the gate: ' + r.stdout);
    });

    // git grep stops at a gitlink, and a marker committed inside a submodule
    // ships when that submodule is published. Whether this checkout has them
    // initialised differs between a dev machine and CI, so the expectation is
    // derived from the actual state rather than hardcoded.
    it('doc-drift scans checked-out submodules and names the ones it could not', () => {
        const listed = spawnSync('git', ['submodule', 'status'], { cwd: repoRoot, encoding: 'utf8' });
        assert.equal(listed.status, 0, 'git submodule status must run');
        const uninitialised = (listed.stdout ?? '').split('\n').filter(Boolean)
            .map(line => line.match(/^(.)[0-9a-f]+\s+(\S+)/))
            .filter((m): m is RegExpMatchArray => Boolean(m) && m![1] === '-')
            .map(m => m[2]);
        const r = runGateOnCi(repoRoot, gateScript);
        assert.equal(r.status, 0, 'expected pass, got: ' + r.stdout + '\n' + r.stderr);
        for (const rel of uninitialised) {
            assert.ok((r.stdout ?? '').includes(rel),
                'an unscanned submodule must be named, not silently counted clean: ' + rel);
        }
        if (uninitialised.length === 0) {
            assert.doesNotMatch(r.stdout ?? '', /uninitialised submodule/,
                'nothing should be reported unscanned when every submodule is checked out');
        }
    });

    it('truth table mentions the four mirrored agbrowse symbols', () => {
        const text = fs.readFileSync(path.join(repoRoot, 'structure/CAPABILITY_TRUTH_TABLE.md'), 'utf8');
        for (const term of ['action-intent', 'target-resolver', 'answer-artifact', 'source-audit']) {
            assert.ok(text.includes(term), `truth table must reference ${term}`);
        }
    });

    describe('generated messaging channel capability matrix', () => {
        // The gate half that turns a stale doc into a release failure. Asserting on
        // the committed text alone would stay green through exactly the drift this
        // exists to catch, so the drift case runs the real generator over a mutated
        // copy of the file and restores it afterwards.
        it('the truth table carries the generated block markers', () => {
            const text = fs.readFileSync(truthTablePath, 'utf8');
            const start = text.indexOf(GENERATED_START);
            const end = text.indexOf(GENERATED_END);
            assert.ok(start >= 0, 'BEGIN marker is missing from the truth table');
            assert.ok(end > start, 'END marker is missing or precedes BEGIN');
            const block = text.slice(start, end);
            assert.match(block, /channel-capabilities\.ts/, 'the block must name the source it came from');
            assert.match(block, /channel-contract-conformance\.test\.ts/, 'the block must name the conformance test');
            assert.match(block, /고치지 마세요|수정하지 마세요/, 'the block must say it is generated and off-limits to hand edits');
        });

        it('--check passes on the committed block', () => {
            const r = runGenerator('--check');
            assert.equal(r.status, 0, `expected in-sync matrix: ${r.stdout}\n${r.stderr}`);
        });

        it('--check fails when the generated block is hand-edited', () => {
            const original = fs.readFileSync(truthTablePath, 'utf8');
            assert.ok(original.includes('| `sendText` |'), 'the matrix row fixture is missing');
            try {
                // Flip a declared capability cell in the doc only; source is untouched.
                fs.writeFileSync(truthTablePath, original.replace('| `sendText` | ✅', '| `sendText` | ❌'));
                const r = runGenerator('--check');
                assert.notEqual(r.status, 0, 'hand-edited matrix must fail --check');
                assert.match(r.stderr, /drift/, `expected a drift message, got: ${r.stderr}`);
                assert.match(r.stderr, /docs:channel-capabilities/, 'the failure must say how to fix it');
            } finally {
                fs.writeFileSync(truthTablePath, original);
            }
            assert.equal(runGenerator('--check').status, 0, 'fixture must restore the committed block');
        });

        it('--check writes nothing', () => {
            const before = fs.readFileSync(truthTablePath);
            runGenerator('--check');
            assert.deepEqual(fs.readFileSync(truthTablePath), before);
        });
    });

    describe('gate-docs keeps the documented gate list honest', () => {
        // structure/INDEX.md hardcodes the gate count and every name. Adding a
        // gate made that row wrong and nothing noticed, because check-docs.mts
        // counts only routes and endpoints. These tests drive the gate against
        // real mutated copies of the doc -- asserting on the gate's source text
        // would have stayed green through exactly the drift it exists to catch.
        const indexPath = path.join(repoRoot, 'structure/INDEX.md');

        /** Run gate-docs against a temporarily mutated structure/INDEX.md. */
        function withMutatedIndex(mutate: (row: string) => string) {
            const original = fs.readFileSync(indexPath, 'utf8');
            const row = original.split('\n').find((line) =>
                line.includes('named gates') && line.includes('runs all'));
            assert.ok(row, 'the release-gates row is missing from structure/INDEX.md');
            try {
                fs.writeFileSync(indexPath, original.replace(row, mutate(row)));
                return runGate('gate-docs');
            } finally {
                fs.writeFileSync(indexPath, original);
            }
        }

        it('passes on the committed docs', () => {
            const r = runGate('gate-docs');
            assert.equal(r.status, 0, r.stdout + r.stderr);
            assert.match(r.stdout, /\[PASS\] gate:gate-docs/);
        });

        it('catches a stale count', () => {
            const r = withMutatedIndex((row) => row.replace(/runs all \d+ named gates/, 'runs all 3 named gates'));
            assert.notEqual(r.status, 0, 'a wrong count must fail');
            assert.match(r.stdout, /count says 3, GATES has \d+/);
        });

        it('catches a gate that exists but is undocumented', () => {
            const r = withMutatedIndex((row) => row.replace('`electron-version`, ', ''));
            assert.notEqual(r.status, 0, 'a missing gate name must fail');
            assert.match(r.stdout, /undocumented: electron-version/);
        });

        it('catches a documented gate that no longer exists', () => {
            // The whole-row-plus-filter approach passed this case: a token
            // shaped like a gate mention was indistinguishable from a retired
            // gate. Reading only the parenthesised list makes it fatal.
            const r = withMutatedIndex((row) => row.replace('`doc-drift`', '`doc-drift-v2`'));
            assert.notEqual(r.status, 0, 'a phantom gate must fail');
            assert.match(r.stdout, /documented but gone: doc-drift-v2/);
        });

        it('does not accuse backticked prose outside the gate list', () => {
            // The earlier draft scanned the entire row, so an ordinary
            // backticked word in the surrounding sentence was reported as a
            // retired gate. The list is scoped to the parenthetical now.
            const r = withMutatedIndex((row) => row.replace(
                'each is npm-addressable', 'each is `npm`-addressable'));
            assert.equal(r.status, 0, `innocent prose was flagged: ${r.stdout}`);
        });

        it('requires every gate to have its npm script', () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as
                { scripts: Record<string, string> };
            const src = fs.readFileSync(gateScript, 'utf8');
            const names = [...src.matchAll(/^ {4}'([a-z0-9-]+)': \{$/gm)].map((m) => m[1]);
            assert.ok(names.length > 0, 'could not read the gate names');
            for (const name of names) {
                assert.equal(pkg.scripts[`gate:${name}`], `node scripts/release-gates.mjs ${name}`,
                    `gate:${name} is not npm-addressable, which structure/INDEX.md promises`);
            }
        });
    });
});

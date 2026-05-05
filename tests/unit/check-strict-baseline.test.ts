// @file tests/unit/check-strict-baseline.test.ts
// Negative-test fixtures for the strict-baseline AST scanner (R2.2.2).
// Verifies the scanner DETECTS each forbidden any-shape and IGNORES
// any-look-alikes inside comments / strings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(__filename, '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts/check-strict-baseline.mjs');

function runScannerOn(srcText: string): { stdout: string; stderr: string; code: number } {
    const dir = mkdtempSync(join(tmpdir(), 'strict-baseline-'));
    try {
        // Mirror the layout the scanner expects.
        mkdirSync(join(dir, 'docs/migration'), { recursive: true });
        mkdirSync(join(dir, 'src'), { recursive: true });
        mkdirSync(join(dir, 'bin'), { recursive: true });
        mkdirSync(join(dir, 'lib'), { recursive: true });
        mkdirSync(join(dir, 'public/manager/src'), { recursive: true });
        mkdirSync(join(dir, 'types'), { recursive: true });
        // Baseline forbids any-counts > 0 in all tracked dirs (zero baseline).
        writeFileSync(join(dir, 'docs/migration/strict-baseline.md'),
            `# baseline\n## any-shapes baseline\n` +
            `| dir | any | debt | allow |\n|-----|----:|-----:|------:|\n` +
            `| src | 0 | 0 | 0 |\n` +
            `| bin | 0 | 0 | 0 |\n` +
            `| lib | 0 | 0 | 0 |\n` +
            `| public/manager/src | 0 | 0 | 0 |\n` +
            `| types | 0 | 0 | 0 |\n`);
        writeFileSync(join(dir, 'src/fixture.ts'), srcText);
        const r = spawnSync('node', [SCRIPT], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            env: { ...process.env, STRICT_BASELINE_ROOT: dir },
        });
        return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? -1 };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('detects: explicit annotation `: any`', () => {
    const r = runScannerOn(`export const x: any = 1;\n`);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /src\.any: live=1/);
});

test('detects: type assertion `as any`', () => {
    const r = runScannerOn(`export const y = (1 as any);\n`);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /src\.any: live=1/);
});

test('detects: generic position Array<any>', () => {
    const r = runScannerOn(`export type A = Array<any>;\n`);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /src\.any: live=1/);
});

test('detects: index signature Record<string, any>', () => {
    const r = runScannerOn(`export type B = Record<string, any>;\n`);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /src\.any: live=1/);
});

test('detects: rest parameter any[]', () => {
    const r = runScannerOn(`export function f(...args: any[]) { return args; }\n`);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /src\.any: live=1/);
});

test('ignores: literal `: any` inside a single-line comment', () => {
    const r = runScannerOn(`// : any\nexport const x = 1;\n`);
    assert.equal(r.code, 0, r.stderr);
});

test('ignores: literal `: any` inside a string literal', () => {
    const r = runScannerOn(`export const s = ": any";\n`);
    assert.equal(r.code, 0, r.stderr);
});

test('@strict-debt(P##) marker shifts count from any to debt and allows it', () => {
    const r = runScannerOn(
        `// @strict-debt(P11): TODO replace after fixture coverage\n` +
        `export function legacy(event: any) { return event; }\n`,
    );
    // baseline.debt=0 means even debt above baseline fails → expect failure
    // because debt=1 > 0. That's the right behaviour: marker only justifies,
    // doesn't auto-bump baseline. PR author must lower baseline alongside.
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /src\.debt: live=1/);
});

test('@strict-allow-any(<reason>) marker shifts to allow column', () => {
    const r = runScannerOn(
        `// @strict-allow-any(contract): JSON-RPC payload\n` +
        `export type Payload = Record<string, any>;\n`,
    );
    // allow column is permanent; scanner does not regress on allow growth.
    assert.equal(r.code, 0, r.stderr || r.stdout);
});

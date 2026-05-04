import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkWebUiBuildOutput } from '../../scripts/check-web-ui-build-output.ts';

function makeDist(indexHtml: string, appJs: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'cli-jaw-build-output-'));
    const assets = join(dir, 'assets');
    mkdirSync(assets);
    writeFileSync(join(dir, 'index.html'), indexHtml);
    writeFileSync(join(assets, 'app-test.js'), appJs);
    return dir;
}

test('build output guard passes dynamic mermaid-loader import', () => {
    const dist = makeDist('<script type="module" src="/assets/app-test.js"></script>', 'const m = () => import("./mermaid-loader-abc.js");');
    const result = checkWebUiBuildOutput({ distDir: dist });
    assert.equal(result.ok, true, result.errors.join('\n'));
});

test('build output guard fails eager modulepreload vendor-utils', () => {
    const dist = makeDist('<link rel="modulepreload" href="/assets/vendor-utils-abc.js"><script type="module" src="/assets/app-test.js"></script>', '');
    const result = checkWebUiBuildOutput({ distDir: dist });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /modulepreloads vendor-utils/);
});

test('build output guard fails static vendor-utils import', () => {
    const dist = makeDist('<script type="module" src="/assets/app-test.js"></script>', 'import "./vendor-utils-abc.js";');
    const result = checkWebUiBuildOutput({ distDir: dist });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /vendor-utils/);
});

test('build output guard fails __vite__mapDeps referencing vendor-mermaid', () => {
    const appJs = 'const deps = __vite__mapDeps(["./vendor-mermaid-abc.js","./chunk-xyz.js"]);';
    const dist = makeDist('<script type="module" src="/assets/app-test.js"></script>', appJs);
    const result = checkWebUiBuildOutput({ distDir: dist });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /vendor-mermaid/);
});

test('build output guard fails when entry bytes exceed budget', () => {
    const bigJs = 'x'.repeat(1000);
    const dist = makeDist('<script type="module" src="/assets/app-test.js"></script>', bigJs);
    const result = checkWebUiBuildOutput({ distDir: dist, entryBudgetBytes: 500 });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /exceed budget/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readSource } from './source-normalize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..', '..');

test('BAO-001: serve --open defaults through headless-aware browser policy', () => {
    const src = readSource(join(root, 'bin', 'commands', 'serve.ts'), 'utf8');
    assert.match(
        src,
        /open:\s*\{\s*type:\s*'boolean',\s*default:\s*shouldOpenBrowserByDefault\(\)\s*\}/,
        'serve.ts should use the shared headless-aware browser open default',
    );
});

test('BAO-002: serve enables JAW_OPEN_BROWSER only when --open is set', () => {
    const src = readSource(join(root, 'bin', 'commands', 'serve.ts'), 'utf8');
    assert.match(
        src,
        /values\.open\s*\?\s*\{\s*JAW_OPEN_BROWSER:\s*'1'\s*\}\s*:\s*\{\s*\}/,
        'serve.ts should conditionally inject JAW_OPEN_BROWSER based on values.open',
    );
});

test('BAO-003: server auto-open is guarded by JAW_OPEN_BROWSER env', () => {
    const src = readSource(join(root, 'server.ts'), 'utf8');
    assert.match(
        src,
        /process\.env\.JAW_OPEN_BROWSER\s*===\s*'1'/,
        'server.ts should only auto-open when JAW_OPEN_BROWSER is explicitly enabled',
    );
});

test('BAO-004: server auto-open skips in test environments', () => {
    const src = readSource(join(root, 'server.ts'), 'utf8');
    assert.match(
        src,
        /isTestEnv/,
        'server.ts should have isTestEnv guard to prevent browser opening during npm test',
    );
});

test('BAO-005: server auto-open uses shared WSL-safe browser opener', () => {
    const src = readSource(join(root, 'server.ts'), 'utf8');
    assert.match(
        src,
        /openUrlInBrowser\(url,\s*\{\s*logPrefix:\s*'serve'\s*\}\)/,
        'server.ts should share the WSL-safe opener used by dashboard',
    );
});

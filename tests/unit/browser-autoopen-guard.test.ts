import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..', '..');

test('BAO-001: serve --open default is true (jaw serve opens browser)', () => {
    const src = fs.readFileSync(join(root, 'bin', 'commands', 'serve.ts'), 'utf8');
    assert.match(
        src,
        /open:\s*\{\s*type:\s*'boolean',\s*default:\s*true\s*\}/,
        'serve.ts should keep --open default true so jaw serve opens browser',
    );
});

test('BAO-002: serve enables JAW_OPEN_BROWSER only when --open is set', () => {
    const src = fs.readFileSync(join(root, 'bin', 'commands', 'serve.ts'), 'utf8');
    assert.match(
        src,
        /values\.open\s*\?\s*\{\s*JAW_OPEN_BROWSER:\s*'1'\s*\}\s*:\s*\{\s*\}/,
        'serve.ts should conditionally inject JAW_OPEN_BROWSER based on values.open',
    );
});

test('BAO-003: server auto-open is guarded by JAW_OPEN_BROWSER env', () => {
    const src = fs.readFileSync(join(root, 'server.ts'), 'utf8');
    assert.match(
        src,
        /process\.env\.JAW_OPEN_BROWSER\s*===\s*'1'/,
        'server.ts should only auto-open when JAW_OPEN_BROWSER is explicitly enabled',
    );
});

test('BAO-004: server auto-open skips in test environments', () => {
    const src = fs.readFileSync(join(root, 'server.ts'), 'utf8');
    assert.match(
        src,
        /isTestEnv/,
        'server.ts should have isTestEnv guard to prevent browser opening during npm test',
    );
});

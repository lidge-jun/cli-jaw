import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

test('/api/runtime exposes cli and model for manager scan rows', () => {
    const server = read('server.ts');

    assert.ok(server.includes('getCliModelAndEffort'), 'runtime snapshot must use the shared CLI model resolver');
    assert.ok(server.includes('const cli = settings.cli || null'), 'runtime snapshot must expose the active CLI');
    assert.ok(server.includes('const model = cli ? getCliModelAndEffort(cli, settings).model :'), 'runtime snapshot must resolve a model fallback');
    assert.ok(server.includes('cli,'), 'runtime snapshot response must include cli');
    assert.ok(server.includes('model,'), 'runtime snapshot response must include model');
});

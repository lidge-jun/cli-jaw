import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

test('vite config includes manager entry and react plugin', () => {
    const vite = read('vite.config.ts');

    assert.ok(vite.includes("@vitejs/plugin-react"), 'Vite must include React plugin');
    assert.ok(vite.includes("manager: 'public/manager/index.html'"), 'Vite must include manager entry');
    assert.ok(vite.includes("app: 'public/index.html'"), 'Vite must preserve existing app entry');
});

test('frontend tsconfig typechecks manager TSX', () => {
    const tsconfig = read('tsconfig.frontend.json');

    assert.ok(tsconfig.includes('"jsx": "react-jsx"'), 'frontend tsconfig must enable react-jsx');
    assert.ok(tsconfig.includes('public/manager/src/**/*.tsx'), 'frontend tsconfig must include manager TSX');
    assert.ok(tsconfig.includes('public/manager/src/**/*.ts'), 'frontend tsconfig must include manager TS');
});

test('manager frontend has API entry and Open action', () => {
    assert.equal(existsSync(join(projectRoot, 'public/manager/index.html')), true);
    const api = read('public/manager/src/api.ts');
    const app = read('public/manager/src/App.tsx');

    assert.ok(api.includes('/api/dashboard/instances'), 'manager API must call dashboard instances endpoint');
    assert.ok(app.includes('Open'), 'manager UI must expose Open action');
    assert.ok(app.includes('Search port, home, CLI, model'), 'manager UI must include search');
});


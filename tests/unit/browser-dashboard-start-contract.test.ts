import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..', '..');
const browserPageSrc = fs.readFileSync(join(root, 'public', 'manager', 'src', 'settings', 'pages', 'Browser.tsx'), 'utf8');

test('BDS-001: dashboard exposes visible and agent browser start paths separately', () => {
    assert.match(browserPageSrc, /onStartVisible/);
    assert.match(browserPageSrc, /onStartAgent/);
    assert.match(browserPageSrc, /mode:\s*'manual',\s*headless:\s*false/);
    assert.match(browserPageSrc, /mode:\s*'agent',\s*headless:\s*true/);
    assert.match(browserPageSrc, /Start visible browser/);
    assert.match(browserPageSrc, /Start agent browser/);
});

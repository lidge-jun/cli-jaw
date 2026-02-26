#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface CheckItem {
    name: string;
    file: string;
    needle: string;
}

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const checks: CheckItem[] = [
    {
        name: 'CLI registry has copilot',
        file: 'src/cli/registry.ts',
        needle: 'copilot:',
    },
    {
        name: 'Server exposes /api/cli-registry',
        file: 'server.ts',
        needle: "app.get('/api/cli-registry'",
    },
    {
        name: 'Settings page includes copilot model select',
        file: 'public/index.html',
        needle: 'id="modelCopilot"',
    },
    {
        name: 'Frontend loads registry from API',
        file: 'public/js/constants.ts',
        needle: "'/api/cli-registry')",
    },
    {
        name: 'Employees UI uses dynamic CLI keys',
        file: 'public/js/features/employees.js',
        needle: 'getCliKeys()',
    },
];

const rows = checks.map((item: CheckItem) => {
    const fullPath = path.join(ROOT, item.file);
    const content: string = fs.existsSync(fullPath)
        ? fs.readFileSync(fullPath, 'utf8')
        : '';
    const ok: boolean = content.includes(item.needle);
    return { ...item, ok };
});

console.log('\nCopilot gap check\n');
for (const row of rows) {
    const icon = row.ok ? 'OK' : 'MISSING';
    console.log(`- ${icon}: ${row.name} (${row.file})`);
}

const failed = rows.filter(r => !r.ok);
if (failed.length) {
    console.error(`\nMissing ${failed.length} required item(s).`);
    process.exit(1);
}

console.log('\nAll checks passed.');

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { constants as osConstants } from 'node:os';
import { DASHBOARD_DEFAULT_PORT, MANAGED_INSTANCE_PORT_COUNT, MANAGED_INSTANCE_PORT_FROM } from '../../src/manager/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const commandRoot = join(__dirname, '..', '..');
const projectRoot = existsSync(join(commandRoot, 'package.json'))
    ? commandRoot
    : join(commandRoot, '..');
const subcommand = process.argv[3] || 'serve';

if (subcommand === 'service') {
    console.error('jaw dashboard service is planned for a later phase.');
    console.error('Use jaw dashboard serve for now.');
    process.exit(1);
}

if (subcommand !== 'serve') {
    console.error(`Unknown dashboard command: ${subcommand}`);
    console.error('Usage: jaw dashboard serve [--port 24576] [--from 3457] [--count 50] [--no-open]');
    process.exit(1);
}

const { values } = parseArgs({
    args: process.argv.slice(4),
    allowNegative: true,
    options: {
        port: { type: 'string', default: process.env.DASHBOARD_PORT || DASHBOARD_DEFAULT_PORT },
        from: { type: 'string', default: String(MANAGED_INSTANCE_PORT_FROM) },
        count: { type: 'string', default: String(MANAGED_INSTANCE_PORT_COUNT) },
        open: { type: 'boolean', default: true },
    },
    strict: false,
});

const serverJs = join(projectRoot, 'dist', 'src', 'manager', 'server.js');
const serverTs = join(projectRoot, 'src', 'manager', 'server.ts');
const isDistMode = existsSync(serverJs);
const command = isDistMode ? process.execPath : (existsSync(join(projectRoot, 'node_modules', '.bin', 'tsx'))
    ? join(projectRoot, 'node_modules', '.bin', 'tsx')
    : 'tsx');
const args = isDistMode ? [serverJs] : [serverTs];

console.log(`\n  Jaw dashboard serve — port ${values.port}`);
console.log(`  Scanning ports ${values.from}-${Number(values.from) + Number(values.count) - 1}\n`);

const child = spawn(command, args, {
    stdio: 'inherit',
    env: {
        ...process.env,
        DASHBOARD_PORT: values.port as string,
        DASHBOARD_SCAN_FROM: values.from as string,
        DASHBOARD_SCAN_COUNT: values.count as string,
        ...(values.open ? { JAW_DASHBOARD_OPEN: '1' } : {}),
    },
});

let exiting = false;

process.on('SIGINT', () => {
    if (exiting) return;
    exiting = true;
    child.kill('SIGINT');
});

process.on('SIGTERM', () => {
    if (exiting) return;
    exiting = true;
    child.kill('SIGTERM');
});

child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    if (signal) {
        const sigCode = osConstants.signals[signal] ?? 9;
        process.exit(128 + sigCode);
    }
    process.exit(code ?? 1);
});

child.on('error', (error: Error) => {
    console.error(`Failed to start dashboard: ${error.message}`);
    process.exit(1);
});

import express from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
    DASHBOARD_DEFAULT_PORT,
    MANAGED_INSTANCE_PORT_COUNT,
    MANAGED_INSTANCE_PORT_FROM,
} from './constants.js';
import { scanDashboardInstances } from './scan.js';
import { installDashboardProxy } from './proxy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(__dirname, '..', '..');
const projectRoot = existsSync(join(serverRoot, 'package.json'))
    ? serverRoot
    : join(serverRoot, '..');
const app = express();

const port = Number(process.env.DASHBOARD_PORT || DASHBOARD_DEFAULT_PORT);
const scanFrom = Number(process.env.DASHBOARD_SCAN_FROM || MANAGED_INSTANCE_PORT_FROM);
const scanCount = Number(process.env.DASHBOARD_SCAN_COUNT || MANAGED_INSTANCE_PORT_COUNT);

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

app.get('/api/dashboard/health', (_req, res) => {
    res.json({
        ok: true,
        port,
        rangeFrom: scanFrom,
        rangeTo: scanFrom + scanCount - 1,
    });
});

app.get('/api/dashboard/instances', async (req, res) => {
    try {
        const from = Number(req.query.from || scanFrom);
        const count = Number(req.query.count || scanCount);
        const result = await scanDashboardInstances({ from, count, managerPort: port });
        res.json(result);
    } catch (error) {
        res.status(500).json({ ok: false, error: (error as Error).message });
    }
});

const distRoot = join(projectRoot, 'public', 'dist');
const sourceRoot = join(projectRoot, 'public');
const managerHtmlCandidates = [
    join(distRoot, 'manager', 'index.html'),
    join(distRoot, 'public', 'manager', 'index.html'),
    join(distRoot, 'manager.html'),
    join(sourceRoot, 'manager', 'index.html'),
];

const server = app.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  Jaw Manager — ${url}`);
    console.log(`  Scanning: ${scanFrom}-${scanFrom + scanCount - 1}\n`);

    if (process.env.JAW_DASHBOARD_OPEN === '1') {
        const openCmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32' ? 'cmd'
                : 'xdg-open';
        const openArgs = process.platform === 'win32'
            ? ['/c', 'start', '', url]
            : [url];
        const opener = spawn(openCmd, openArgs, { detached: true, stdio: 'ignore' });
        opener.unref();
    }
});

installDashboardProxy(app, server, { from: scanFrom, count: scanCount });

app.use('/dist', express.static(distRoot));
app.use('/assets', express.static(join(distRoot, 'assets')));
app.use('/manager', express.static(join(sourceRoot, 'manager')));

app.get('/{*splat}', (_req, res) => {
    const htmlPath = managerHtmlCandidates.find(candidate => existsSync(candidate));
    if (!htmlPath) {
        return res.status(500).send('manager dashboard has not been built');
    }
    res.sendFile(htmlPath);
});

server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`[dashboard] port ${port} already in use`);
    } else {
        console.error(`[dashboard] listen error: ${error.message}`);
    }
    process.exit(1);
});

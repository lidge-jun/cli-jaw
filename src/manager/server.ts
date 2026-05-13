import express from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DASHBOARD_DEFAULT_PORT,
    DASHBOARD_PREVIEW_PORT_FROM,
    MANAGED_INSTANCE_PORT_COUNT,
    MANAGED_INSTANCE_PORT_FROM,
} from './constants.js';
import { scanDashboardInstances, scanSinglePort } from './scan.js';
import { installDashboardProxy } from './proxy.js';
import { createPreviewOriginProxyController } from './preview-origin-proxy.js';
import { DashboardLifecycleManager } from './lifecycle.js';
import { createDashboardShutdown } from './shutdown.js';
import { parsePositiveCount, parsePositivePort } from './security.js';
import {
    applyDashboardRegistry,
    loadDashboardRegistry,
    patchDashboardRegistry,
} from './registry.js';
import { createHealthHistory, type HealthEvent } from './health-history.js';
import { createObservability } from './observability.js';
import { fetchInstanceLogs } from './logs.js';
import {
    createDashboardNotesRouter,
} from './notes/routes.js';
import { createDesktopStatusRouter } from './routes/desktop-status.js';
import { createElectronMetricsRouter } from './routes/electron-metrics.js';
import { createDashboardBoardRouter } from './board/routes.js';
import { createDashboardScheduleRouter } from './schedule/routes.js';
import { ScheduleStore } from './schedule/store.js';
import { startScheduleRunner } from './schedule/runner.js';
import { createDashboardRemindersRouter } from './reminders/routes.js';
import { RemindersStore } from './reminders/store.js';
import { startRemindersScheduler } from './reminders/scheduler.js';
import { createDashboardConnectorRouter } from './connector/routes.js';
import { createDashboardMemoryRouter } from './routes/dashboard-memory.js';
import { fetchWorkerAssistantTextById } from './worker-messages.js';
import { openUrlInBrowser } from '../core/browser-open.js';
import { ensureDirs, loadSettings } from '../core/config.js';
import { createJawCeoRouter } from '../routes/jaw-ceo.js';
import type {
    DashboardInstance,
    DashboardServiceState,
    DashboardLifecycleAction,
    DashboardLifecycleResult,
    DashboardRegistryPatch,
    DashboardScanResult,
} from './types.js';
import { detectAllServiceStates, detectServiceState, isServiceSupported } from './platform-service.js';
import { defaultHomeForPort } from './lifecycle-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(__dirname, '..', '..');
const projectRoot = existsSync(join(serverRoot, 'package.json'))
    ? serverRoot
    : join(serverRoot, '..');
const app = express();
ensureDirs();
loadSettings();

const port = parsePositivePort(process.env["DASHBOARD_PORT"], Number(DASHBOARD_DEFAULT_PORT));
const scanFrom = parsePositivePort(process.env["DASHBOARD_SCAN_FROM"], MANAGED_INSTANCE_PORT_FROM);
const scanCount = parsePositiveCount(
    process.env["DASHBOARD_SCAN_COUNT"],
    MANAGED_INSTANCE_PORT_COUNT,
    MANAGED_INSTANCE_PORT_COUNT,
);
const previewFrom = parsePositivePort(process.env["DASHBOARD_PREVIEW_FROM"], DASHBOARD_PREVIEW_PORT_FROM);
const lifecycle = new DashboardLifecycleManager({
    managerPort: port,
    from: scanFrom,
    count: scanCount,
});
const healthHistory = createHealthHistory();
const observability = createObservability();
const previewProxy = createPreviewOriginProxyController({
    scanFrom,
    scanCount,
    previewFrom,
    managerPort: port,
    bindHost: '127.0.0.1',
});
const previousStatusByPort = new Map<number, { status: string; version: string | null }>();

async function serviceDetect(range: { from: number; to: number }): Promise<Map<number, DashboardServiceState>> {
    return detectAllServiceStates(range);
}

async function serviceDetectSingle(port: number, home?: string): Promise<DashboardServiceState | null> {
    if (!isServiceSupported()) return null;
    return detectServiceState(port, home || defaultHomeForPort(port));
}

function recordScanEvents(result: DashboardScanResult): void {
    const at = result.manager.checkedAt;
    let reachable = 0;
    for (const instance of result.instances) {
        if (instance.ok) reachable += 1;
        const previous = previousStatusByPort.get(instance.port);
        if (previous && previous.status !== instance.status) {
            observability.publish({
                kind: 'health-changed',
                port: instance.port,
                from: previous.status as DashboardInstance['status'],
                to: instance.status,
                reason: instance.healthReason,
                at,
            });
        }
        if (previous && previous.version && instance.version && previous.version !== instance.version) {
            observability.publish({
                kind: 'version-mismatch',
                port: instance.port,
                expected: previous.version,
                seen: instance.version,
                at,
            });
        }
        const event: HealthEvent = {
            port: instance.port,
            at,
            status: instance.status,
            reason: instance.healthReason,
            versionSeen: instance.version,
        };
        healthHistory.record(event);
        previousStatusByPort.set(instance.port, { status: instance.status, version: instance.version });
    }
    observability.publish({
        kind: 'scan-completed',
        from: result.manager.rangeFrom,
        to: result.manager.rangeTo,
        reachable,
        at,
    });
}

function attachPreviewSnapshot(result: DashboardScanResult): DashboardScanResult {
    result.manager.proxy.preview = previewProxy.snapshot();
    return result;
}

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));
app.use(
    '/api/dashboard/notes',
    createDashboardNotesRouter({ managerPort: port }),
);
app.use(express.json({ limit: '64kb' }));
app.use('/api/dashboard/desktop-status', createDesktopStatusRouter());
app.use('/api/dashboard/electron-metrics', createElectronMetricsRouter());
app.use('/api/dashboard/board', createDashboardBoardRouter());
const scheduleStore = new ScheduleStore();
app.use('/api/dashboard/schedule', createDashboardScheduleRouter({ store: scheduleStore }));
const remindersStore = new RemindersStore();
app.use('/api/dashboard/reminders', createDashboardRemindersRouter({ store: remindersStore }));
app.use('/api/dashboard/connector', createDashboardConnectorRouter({ remindersStore }));

const memoryScanSupplier = async () => {
    const loaded = loadDashboardRegistry({ from: scanFrom, count: scanCount });
    const scan = await scanDashboardInstances({
        from: loaded.registry.scan.from,
        count: loaded.registry.scan.count,
        managerPort: port,
    });
    return scan.instances.map(i => ({
        port: i.port,
        profileId: i.profileId ?? null,
        homeDisplay: i.homeDisplay ?? null,
    }));
};
app.use('/api/dashboard/memory', createDashboardMemoryRouter({
    managerPort: port,
    scanSupplier: memoryScanSupplier,
}));

let stopRemindersScheduler: (() => void) | null = null;

app.use('/api/jaw-ceo', createJawCeoRouter({
    repoRoot: projectRoot,
    listInstances: async () => {
        const loaded = loadDashboardRegistry({ from: scanFrom, count: scanCount });
        const result = await scanDashboardInstances({ from: loaded.registry.scan.from, count: loaded.registry.scan.count, managerPort: port });
        const serviceStates = await serviceDetect({
            from: loaded.registry.scan.from,
            to: loaded.registry.scan.from + loaded.registry.scan.count - 1,
        });
        const decorated = lifecycle.decorateScanResult(result, serviceStates);
        const applied = applyDashboardRegistry(attachPreviewSnapshot(decorated), loaded.registry, loaded.status, { showHidden: false });
        return applied.instances.map(instance => ({
            port: instance.port,
            label: instance.label || instance.profileId || `:${instance.port}`,
            status: instance.status,
            ok: instance.ok,
            url: instance.url,
            currentCli: instance.currentCli,
            currentModel: instance.currentModel,
            workingDir: instance.workingDir,
        }));
    },
    fetchLatestMessage: async (targetPort) => {
        const response = await fetch(`http://127.0.0.1:${targetPort}/api/messages/latest?includeContent=1`);
        if (!response.ok) return null;
        const body = await response.json() as {
            ok?: boolean;
            data?: {
                latestAssistant?: { id?: number; role?: string; created_at?: string; text?: string; content?: string } | null;
                activity?: { messageId?: number; role?: string; title?: string; updatedAt?: string } | null;
            } | null;
        };
        const latest = body.data?.latestAssistant;
        const latestId = latest?.id ? Number(latest.id) : null;
        const directText = latest && typeof latest.text === 'string' ? latest.text : String(latest?.content || '');
        const fallbackText = latestId && !directText.trim()
            ? await fetchWorkerAssistantTextById(fetch, targetPort, latestId).catch(() => '')
            : '';
        return {
            latestAssistant: latest && latestId ? {
                id: latestId,
                role: 'assistant',
                ...(latest.created_at ? { created_at: String(latest.created_at) } : {}),
                text: directText || fallbackText,
            } : null,
            activity: body.data?.activity?.messageId ? {
                messageId: Number(body.data.activity.messageId),
                role: String(body.data.activity.role || ''),
                ...(body.data.activity.title ? { title: String(body.data.activity.title) } : {}),
                ...(body.data.activity.updatedAt ? { updatedAt: String(body.data.activity.updatedAt) } : {}),
            } : null,
        };
    },
    sendWorkerMessage: async ({ port: targetPort, prompt }) => {
        const response = await fetch(`http://127.0.0.1:${targetPort}/api/message`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ prompt }),
        });
        const data = await response.json().catch(() => null) as unknown;
        return {
            ok: response.ok,
            status: response.status,
            message: response.ok ? 'sent' : `worker send failed: ${response.status}`,
            data,
        };
    },
    runLifecycleAction: async ({ action, port: targetPort }) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/dashboard/lifecycle/${action}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ port: targetPort }),
        });
        const data = await response.json().catch(() => null) as DashboardLifecycleResult | null;
        return {
            ok: Boolean(response.ok && data?.ok),
            message: data?.message || `lifecycle ${action} failed: ${response.status}`,
            ...(data?.status ? { status: data.status } : {}),
            data,
        };
    },
}));

app.get('/api/dashboard/health', (_req, res) => {
    res.json({
        ok: true,
        app: 'cli-jaw',
        service: 'manager-dashboard',
        port,
        pid: process.pid,
        rangeFrom: scanFrom,
        rangeTo: scanFrom + scanCount - 1,
    });
});

app.get('/api/dashboard/instances', async (req, res) => {
    try {
        const loaded = loadDashboardRegistry({ from: scanFrom, count: scanCount });
        const from = Number(req.query["from"] || loaded.registry.scan.from);
        const count = Number(req.query["count"] || loaded.registry.scan.count);
        const showHidden = req.query["showHidden"] === '1' || req.query["showHidden"] === 'true';
        const result = await scanDashboardInstances({ from, count, managerPort: port });
        recordScanEvents(result);
        await previewProxy.reconcileOnlineTargets(
            result.instances.filter(instance => instance.ok).map(instance => instance.port)
        );
        const serviceStates = await serviceDetect({ from, to: from + count - 1 });
        const decorated = lifecycle.decorateScanResult(result, serviceStates);
        const applied = applyDashboardRegistry(attachPreviewSnapshot(decorated), loaded.registry, loaded.status, { showHidden });
        res.json({ ...applied, platform: process.platform });
    } catch (error) {
        observability.publish({ kind: 'scan-failed', reason: (error as Error).message, at: new Date().toISOString() });
        res.status(500).json({ ok: false, error: (error as Error).message });
    }
});

app.get('/api/dashboard/instances/:port', async (req, res) => {
    const portValue = Number(req.params.port);
    if (!Number.isInteger(portValue) || portValue < scanFrom || portValue >= scanFrom + scanCount) {
        res.status(400).json({ ok: false, error: 'port out of configured scan range' });
        return;
    }
    try {
        const loaded = loadDashboardRegistry({ from: scanFrom, count: scanCount });
        const instance = await scanSinglePort(portValue);
        if (instance.ok) await previewProxy.ensureTarget(instance.port);
        const serviceStates = await serviceDetect({ from: portValue, to: portValue });
        const decorated = lifecycle.decorateScanResult({
            manager: {
                port,
                rangeFrom: scanFrom,
                rangeTo: scanFrom + scanCount - 1,
                checkedAt: instance.lastCheckedAt,
                proxy: { enabled: true, basePath: '/i', allowedFrom: scanFrom, allowedTo: scanFrom + scanCount - 1 },
            },
            instances: [instance],
        }, serviceStates);
        const applied = applyDashboardRegistry(attachPreviewSnapshot(decorated), loaded.registry, loaded.status, { showHidden: true });
        res.json({ ok: true, instance: applied.instances[0] || null, manager: applied.manager, platform: process.platform });
    } catch (error) {
        res.status(500).json({ ok: false, error: (error as Error).message });
    }
});

app.get('/api/manager/events', (req, res) => {
    const since = typeof req.query["since"] === 'string' && req.query["since"] ? req.query["since"] : null;
    if (since && Number.isNaN(Date.parse(since))) {
        res.status(400).json({ ok: false, error: 'since must be a valid ISO 8601 timestamp' });
        return;
    }
    res.json({ ok: true, events: observability.drain(since) });
});

app.get('/api/manager/health-history/:port', (req, res) => {
    const portValue = Number(req.params.port);
    if (!Number.isInteger(portValue) || portValue < scanFrom || portValue >= scanFrom + scanCount) {
        res.status(400).json({ ok: false, error: 'port out of configured scan range' });
        return;
    }
    const limit = req.query["limit"] ? Math.max(1, Math.min(200, Number(req.query["limit"]))) : undefined;
    res.json({ ok: true, port: portValue, events: healthHistory.list(portValue, limit) });
});

app.get('/api/manager/instance-logs/:port', async (req, res) => {
    const portValue = Number(req.params.port);
    if (!Number.isInteger(portValue) || portValue < scanFrom || portValue >= scanFrom + scanCount) {
        res.status(400).json({ ok: false, error: 'port out of configured scan range' });
        return;
    }
    try {
        const snapshot = await fetchInstanceLogs(portValue);
        res.json({ ok: true, snapshot });
    } catch (error) {
        res.status(500).json({ ok: false, error: (error as Error).message });
    }
});

app.get('/api/dashboard/registry', (_req, res) => {
    const loaded = loadDashboardRegistry({ from: scanFrom, count: scanCount });
    res.json(loaded);
});

app.patch('/api/dashboard/registry', (req, res) => {
    try {
        const patch = req.body && typeof req.body === 'object'
            ? req.body as DashboardRegistryPatch
            : {};
        res.json(patchDashboardRegistry(patch, { from: scanFrom, count: scanCount }));
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: (error as Error).message,
        });
    }
});

app.post('/api/dashboard/lifecycle/:action', async (req, res) => {
    const action = String(req.params.action || '') as DashboardLifecycleAction;
    const portValue = Number(req.body?.port);
    const home = typeof req.body?.home === 'string' ? req.body.home : undefined;
    if (!['start', 'stop', 'restart', 'perm', 'unperm'].includes(action)) {
        res.status(400).json({
            ok: false,
            action,
            port: portValue,
            status: 'rejected',
            message: `Unsupported lifecycle action: ${action}`,
            home: null,
            pid: null,
            command: [],
        });
        return;
    }
    if (!Number.isInteger(portValue)) {
        res.status(400).json({
            ok: false,
            action,
            port: portValue,
            status: 'rejected',
            message: 'port must be an integer',
            home: null,
            pid: null,
            command: [],
        });
        return;
    }

    try {
        let result: DashboardLifecycleResult;
        if (action === 'perm') {
            result = await lifecycle.perm(portValue, home);
        } else if (action === 'unperm') {
            result = await lifecycle.unperm(portValue, home);
        } else {
            const serviceState = await serviceDetectSingle(portValue, home);
            result = action === 'start'
                ? await lifecycle.start(portValue, home, serviceState)
                : action === 'stop'
                    ? await lifecycle.stop(portValue, serviceState)
                    : await lifecycle.restart(portValue, serviceState);
        }
        observability.publish({
            kind: 'lifecycle-result',
            port: portValue,
            action,
            status: result.status,
            message: result.message,
            at: new Date().toISOString(),
        });
        res.status(result.ok ? 200 : 409).json(result);
    } catch (error) {
        res.status(500).json({
            ok: false,
            action,
            port: portValue,
            status: 'error',
            message: (error as Error).message,
            home: null,
            pid: null,
            command: [],
        });
    }
});

app.get('/api/dashboard/process-control', (_req, res) => {
    res.json({ ok: true, state: lifecycle.processControlState() });
});

app.post('/api/dashboard/process-control/adopt', async (_req, res) => {
    try {
        const result = await lifecycle.hydrate();
        res.json({ ok: true, result, state: lifecycle.processControlState() });
    } catch (error) {
        res.status(500).json({ ok: false, error: (error as Error).message });
    }
});

app.post('/api/dashboard/process-control/stop-managed', async (_req, res) => {
    try {
        const results = await lifecycle.stopAll();
        res.json({ ok: true, results, state: lifecycle.processControlState() });
    } catch (error) {
        res.status(500).json({ ok: false, error: (error as Error).message });
    }
});

app.post('/api/dashboard/process-control/force-release', (_req, res) => {
    res.status(501).json({
        ok: false,
        error: 'Force release is planned but disabled until strict command/home ownership proof is implemented.',
    });
});

const distRoot = join(projectRoot, 'public', 'dist');
const sourceRoot = join(projectRoot, 'public');
const managerHtmlCandidates = [
    join(distRoot, 'manager', 'index.html'),
    join(distRoot, 'public', 'manager', 'index.html'),
    join(distRoot, 'manager.html'),
    join(sourceRoot, 'manager', 'index.html'),
];

function managerUiSource(htmlPath: string): 'dist' | 'source' {
    return htmlPath.startsWith(distRoot) ? 'dist' : 'source';
}

function sendManagerHtml(res: express.Response, htmlPath: string): void {
    res.setHeader('x-jaw-manager-ui', managerUiSource(htmlPath));
    res.sendFile(basename(htmlPath), { root: dirname(htmlPath) }, error => {
        if (!error || res.headersSent) return;

        console.error(`[dashboard] failed to serve manager html: ${error.message}`);
        res.status(500).send('manager dashboard failed to load');
    });
}

app.use('/dist', express.static(distRoot));
app.use('/assets', express.static(join(distRoot, 'assets')));
app.use('/icons', express.static(join(sourceRoot, 'icons')));
app.use('/manager', express.static(join(sourceRoot, 'manager'), { index: false }));

app.get('/.well-known/appspecific/com.chrome.devtools.json', (_req, res) => {
    res.status(204).end();
});

app.get('/favicon.ico', (_req, res) => {
    res.sendFile('icon-192.png', { root: join(sourceRoot, 'icons') }, error => {
        if (!error || res.headersSent) return;
        res.status(204).end();
    });
});

const server = http.createServer(app);
installDashboardProxy(app, server, { from: scanFrom, count: scanCount });

app.get('/{*splat}', (_req, res) => {
    const htmlPath = managerHtmlCandidates.find(candidate => existsSync(candidate));
    if (!htmlPath) {
        res.status(500).send('manager dashboard has not been built');
        return;
    }
    sendManagerHtml(res, htmlPath);
});

server.on('error', (error: NodeJS.ErrnoException) => {
    void previewProxy.close();
    if (error.code === 'EADDRINUSE') {
        console.error(`[dashboard] port ${port} already in use`);
    } else {
        console.error(`[dashboard] listen error: ${error.message}`);
    }
    process.exit(1);
});

const shutdown = createDashboardShutdown({
    lifecycle,
    previewProxy,
    server,
    exit: code => process.exit(code),
});

async function shutdownDashboard(): Promise<void> {
    stopRemindersScheduler?.();
    await shutdown();
}

process.once('SIGINT', () => void shutdownDashboard());
process.once('SIGTERM', () => void shutdownDashboard());

async function main(): Promise<void> {
    previewProxy.validate();
    try {
        const hydrated = await lifecycle.hydrate();
        if (hydrated.adopted > 0 || hydrated.pruned > 0) {
            console.log(`[dashboard] adopted ${hydrated.adopted} child instance(s), pruned ${hydrated.pruned} stale entry(ies)`);
        }
    } catch (error) {
        console.error(`[dashboard] hydrate failed: ${(error as Error).message}`);
    }
    server.listen(port, '127.0.0.1', () => {
        const url = `http://localhost:${port}`;
        console.log(`\n  Jaw Manager — ${url}`);
        console.log(`  Scanning: ${scanFrom}-${scanFrom + scanCount - 1}`);
        console.log(`  Preview: ${previewFrom}-${previewFrom + scanCount - 1}\n`);

        startScheduleRunner(scheduleStore, {
            log: msg => console.log(msg),
        });
        if (process.env["JAW_REMINDERS_SCHEDULER"] === '1') {
            stopRemindersScheduler = startRemindersScheduler({
                store: remindersStore,
                observability,
                log: msg => console.log(msg),
            });
            console.log('  Reminders scheduler: enabled');
        }

        if (process.env["JAW_DASHBOARD_OPEN"] === '1') {
            openUrlInBrowser(url, { logPrefix: 'dashboard' });
        }
    });
}

void main().catch(async (error: Error) => {
    await previewProxy.close();
    console.error(`[dashboard] startup failed: ${error.message}`);
    process.exit(1);
});

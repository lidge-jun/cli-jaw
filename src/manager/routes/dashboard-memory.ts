import express, { type RequestHandler } from 'express';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { searchFederated } from '../memory/federation.js';
import { listSearchableInstancesFromScan } from '../memory/instance-discovery.js';
import type { ScanItemForFederation } from '../memory/types.js';
import { resolveStructuredMemoryDir } from '../../memory/shared.js';
import { isExpectedHostHeader, isAllowedOriginHeader } from '../security.js';

const MAX_QUERY_LEN = 256;
const MAX_RESULT_LIMIT = 200;
const DEFAULT_RESULT_LIMIT = 50;
const MAX_READ_BYTES = 256 * 1024;

export type ScanSupplier = () => Promise<ScanItemForFederation[]>;

function requireManagerOrigin(managerPort: number): RequestHandler {
    const allowed = [`http://127.0.0.1:${managerPort}`, `http://localhost:${managerPort}`];
    return (req, res, next) => {
        const host = isExpectedHostHeader(req.headers.host, {
            host: '127.0.0.1', port: managerPort, allowLocalhostAlias: true,
        });
        const origin = isAllowedOriginHeader(req.headers.origin, {
            allowedOrigins: allowed, allowMissing: true,
        });
        if (!host || !origin) {
            res.status(403).json({ ok: false, code: 'memory_origin_forbidden' });
            return;
        }
        next();
    };
}

export interface DashboardMemoryRouterOptions {
    managerPort: number;
    scanSupplier: ScanSupplier;
}

export function createDashboardMemoryRouter(opts: DashboardMemoryRouterOptions): express.Router {
    const router = express.Router();
    router.use(requireManagerOrigin(opts.managerPort));

    router.get('/instances', async (_req, res) => {
        try {
            const scan = await opts.scanSupplier();
            res.json({ ok: true, instances: listSearchableInstancesFromScan(scan) });
        } catch (err) {
            res.status(500).json({ ok: false, code: 'scan_failed', message: (err as Error).message });
        }
    });

    router.get('/search', async (req, res) => {
        const q = String(req.query["q"] || '').trim();
        if (!q) { res.status(400).json({ ok: false, code: 'invalid_query' }); return; }
        if (q.length > MAX_QUERY_LEN) { res.status(400).json({ ok: false, code: 'query_too_long' }); return; }
        const filter = String(req.query["instance"] || '').split(',').map(s => s.trim()).filter(Boolean);
        const requestedLimit = Number(req.query["limit"]);
        const limit = Number.isFinite(requestedLimit)
            ? Math.min(Math.max(1, requestedLimit), MAX_RESULT_LIMIT)
            : DEFAULT_RESULT_LIMIT;
        try {
            const scan = await opts.scanSupplier();
            const refs = listSearchableInstancesFromScan(scan);
            const targets = filter.length ? refs.filter(r => filter.includes(r.instanceId)) : refs;
            const result = searchFederated(q, { instances: targets, globalLimit: limit });
            res.json({ ok: true, ...result });
        } catch (err) {
            res.status(500).json({ ok: false, code: 'search_failed', message: (err as Error).message });
        }
    });

    router.get('/read', async (req, res) => {
        const instanceId = String(req.query["instance"] || '');
        const relPath = String(req.query["path"] || '');
        if (!instanceId || !relPath) { res.status(400).json({ ok: false, code: 'invalid_args' }); return; }
        let scan: ScanItemForFederation[];
        try { scan = await opts.scanSupplier(); }
        catch (err) { res.status(500).json({ ok: false, code: 'scan_failed', message: (err as Error).message }); return; }
        const ref = listSearchableInstancesFromScan(scan).find(r => r.instanceId === instanceId);
        if (!ref) { res.status(404).json({ ok: false, code: 'instance_not_found' }); return; }

        let homeReal: string;
        try { homeReal = realpathSync(ref.homePath); }
        catch { res.status(404).json({ ok: false, code: 'home_not_found' }); return; }

        let memRoot: string;
        try { memRoot = realpathSync(resolveStructuredMemoryDir(ref.homePath)); }
        catch { res.status(404).json({ ok: false, code: 'memory_root_not_found' }); return; }

        const rootEscapeRel = relative(homeReal, memRoot).replace(/\\/g, '/');
        if (rootEscapeRel === '..' || rootEscapeRel.startsWith('../') || rootEscapeRel.startsWith('/')) {
            res.status(400).json({ ok: false, code: 'memory_root_escapes_home' });
            return;
        }

        const targetRaw = resolve(memRoot, relPath);
        try {
            const lstat = lstatSync(targetRaw);
            if (lstat.isSymbolicLink()) {
                res.status(400).json({ ok: false, code: 'symlink_forbidden' });
                return;
            }
        } catch {
            res.status(404).json({ ok: false, code: 'file_not_found' });
            return;
        }

        let targetReal: string;
        try { targetReal = realpathSync(targetRaw); }
        catch { res.status(404).json({ ok: false, code: 'file_not_found' }); return; }

        const rel = relative(memRoot, targetReal).replace(/\\/g, '/');
        if (rel === '..' || rel.startsWith('../') || rel.startsWith('/')) {
            res.status(400).json({ ok: false, code: 'path_out_of_root' });
            return;
        }

        if (extname(targetReal).toLowerCase() !== '.md') {
            res.status(400).json({ ok: false, code: 'unsupported_extension' });
            return;
        }

        if (!existsSync(targetReal)) { res.status(404).json({ ok: false, code: 'file_not_found' }); return; }
        const stat = statSync(targetReal);
        if (!stat.isFile()) { res.status(400).json({ ok: false, code: 'not_a_file' }); return; }
        if (stat.size > MAX_READ_BYTES) {
            res.status(413).json({ ok: false, code: 'file_too_large', size: stat.size, max: MAX_READ_BYTES });
            return;
        }
        res.json({ ok: true, instanceId, path: rel, content: readFileSync(targetReal, 'utf8') });
    });

    return router;
}

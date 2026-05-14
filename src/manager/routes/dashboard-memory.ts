import express, { type RequestHandler } from 'express';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { searchFederated } from '../memory/federation.js';
import { listSearchableInstancesFromScan } from '../memory/instance-discovery.js';
import type { ScanItemForFederation } from '../memory/types.js';
import { resolveStructuredMemoryDir } from '../../memory/shared.js';
import { isExpectedHostHeader, isAllowedOriginHeader } from '../security.js';
import { VecStore, getVecDbPath, createProvider, syncAllInstances } from '../memory/embedding/index.js';
import type { EmbeddingConfig } from '../memory/embedding/index.js';
import { hybridMerge } from '../memory/embedding/hybrid-search.js';

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
    embeddingConfig: () => EmbeddingConfig | null;
    vecStore: () => VecStore | null;
    dashboardHome: string;
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
        const modeOverride = String(req.query["mode"] || '').trim() as '' | 'fts5' | 'embedding' | 'hybrid';
        try {
            const scan = await opts.scanSupplier();
            const refs = listSearchableInstancesFromScan(scan);
            const targets = filter.length ? refs.filter(r => filter.includes(r.instanceId)) : refs;

            const embConfig = opts.embeddingConfig();
            const searchMode = modeOverride || embConfig?.searchMode || 'fts5';
            const vec = opts.vecStore();

            if (searchMode === 'fts5' || !embConfig?.enabled || !vec) {
                const result = searchFederated(q, { instances: targets, globalLimit: limit });
                res.json({ ok: true, mode: 'fts5', ...result });
            } else if (searchMode === 'embedding') {
                const provider = await createProvider(embConfig);
                const embedResult = await provider.embed([q]);
                const queryVec = embedResult[0]!;
                const vecHits = vec.search(queryVec, limit);
                const hits = vecHits.map(v => ({
                    path: '',
                    relpath: v.relpath,
                    kind: v.kind,
                    source_start_line: v.sourceStartLine,
                    source_end_line: v.sourceEndLine,
                    snippet: v.snippet,
                    score: 0,
                    instanceId: v.instanceId,
                    embeddingDistance: v.distance,
                }));
                res.json({
                    ok: true,
                    mode: 'embedding',
                    hits,
                    warnings: [],
                    instancesQueried: targets.length,
                    instancesSucceeded: targets.length,
                });
            } else {
                const ftsResult = searchFederated(q, { instances: targets, globalLimit: limit * 2 });
                const provider = await createProvider(embConfig);
                const embedResult = await provider.embed([q]);
                const queryVec = embedResult[0]!;
                const vecHits = vec.search(queryVec, limit * 2);
                const ftsWithInstance = ftsResult.hits.map(h => ({ ...h, instanceId: h.instanceId || 'default' }));
                const merged = hybridMerge({ ftsHits: ftsWithInstance, vecHits, limit });
                res.json({
                    ok: true,
                    mode: 'hybrid',
                    hits: merged,
                    warnings: ftsResult.warnings,
                    instancesQueried: ftsResult.instancesQueried,
                    instancesSucceeded: ftsResult.instancesSucceeded,
                });
            }
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

    router.get('/embed-config', (_req, res) => {
        const config = opts.embeddingConfig();
        res.json({ ok: true, config: config || null });
    });

    router.post('/embed-config', express.json(), async (req, res) => {
        try {
            const config = req.body as Partial<EmbeddingConfig>;
            if (config.provider && !['openai', 'gemini', 'voyage', 'local'].includes(config.provider)) {
                res.status(400).json({ ok: false, code: 'invalid_provider' });
                return;
            }
            const settingsPath = join(opts.dashboardHome, 'embedding.json');
            writeFileSync(settingsPath, JSON.stringify(config, null, 2), 'utf8');

            const prev = opts.embeddingConfig();
            const providerChanged = prev && (prev.provider !== config.provider || prev.model !== config.model || prev.dimensions !== config.dimensions);

            res.json({ ok: true, saved: true, needsReindex: providerChanged || false });
        } catch (err) {
            res.status(500).json({ ok: false, error: String(err) });
        }
    });

    router.post('/reindex', async (_req, res) => {
        const embConfig = opts.embeddingConfig();
        if (!embConfig?.enabled) {
            res.status(400).json({ ok: false, code: 'embedding_not_enabled' });
            return;
        }
        const vec = opts.vecStore();
        if (!vec) {
            res.status(500).json({ ok: false, code: 'vecstore_not_initialized' });
            return;
        }
        try {
            const scan = await opts.scanSupplier();
            const instances = listSearchableInstancesFromScan(scan);
            const provider = await createProvider(embConfig);
            const results = await syncAllInstances({
                instances,
                vecStore: vec,
                provider,
            });
            res.json({ ok: true, results });
        } catch (err) {
            res.status(500).json({ ok: false, error: String(err) });
        }
    });

    return router;
}

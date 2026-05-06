import type { Express, NextFunction, Request, Response } from 'express';
import { fail, ok } from '../http/response.js';
import { getTraceEvent, getTraceRun, listTraceEvents } from '../trace/store.js';

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void;

function parseLimit(value: unknown, fallback: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(200, Math.floor(n)));
}

function parseOffset(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
}

function publicRunOrFail(req: Request, res: Response) {
    const run = getTraceRun(String(req.params["runId"] || ''));
    if (!run || run.audience !== 'public') {
        fail(res, 404, 'trace_not_found');
        return null;
    }
    return run;
}

export function registerTraceRoutes(app: Express, requireAuth: AuthMiddleware): void {
    app.get('/api/traces/:runId', requireAuth, (req, res) => {
        const run = publicRunOrFail(req, res);
        if (!run) return;
        ok(res, {
            id: run.id,
            messageId: run.message_id ?? null,
            cli: run.cli || '',
            model: run.model || '',
            workingDir: run.working_dir || '',
            agentLabel: run.agent_label || '',
            status: run.status || 'running',
            rawRetentionStatus: run.raw_retention_status || 'available',
            eventCount: run.event_count || 0,
            byteCount: run.byte_count || 0,
            startedAt: run.started_at || 0,
            finishedAt: run.finished_at || null,
            error: run.error || null,
        });
    });

    app.get('/api/traces/:runId/events', requireAuth, (req, res) => {
        const run = publicRunOrFail(req, res);
        if (!run) return;
        ok(res, listTraceEvents(run.id, parseOffset(req.query["offset"]), parseLimit(req.query["limit"], 80)));
    });

    app.get('/api/traces/:runId/events/:seq', requireAuth, (req, res) => {
        const run = publicRunOrFail(req, res);
        if (!run) return;
        const seq = Number(req.params["seq"]);
        if (!Number.isInteger(seq) || seq < 1) {
            fail(res, 400, 'invalid_trace_seq');
            return;
        }
        const event = getTraceEvent(run.id, seq);
        if (!event) {
            fail(res, 404, 'trace_event_not_found');
            return;
        }
        ok(res, {
            runId: event.run_id,
            seq: event.seq,
            source: event.source,
            eventType: event.event_type,
            preview: event.preview || '',
            bytes: event.bytes || 0,
            retentionStatus: event.retention_status || 'available',
            createdAt: event.created_at || 0,
            raw: event.raw,
        });
    });
}

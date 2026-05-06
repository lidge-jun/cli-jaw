import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { registerTraceRoutes } from '../../src/routes/traces.ts';
import { appendTraceEvent, startTraceRun } from '../../src/trace/store.ts';

function noAuth(_req: Request, _res: Response, next: NextFunction): void {
    next();
}

async function withServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
    const app = express();
    registerTraceRoutes(app, noAuth);
    const server: Server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    try {
        await fn(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}

test('trace routes expose public traces with bounded event pages', async () => {
    const runId = startTraceRun({ cli: 'codex', audience: 'public' });
    appendTraceEvent({ runId, source: 'cli_raw', eventType: 'event', raw: { ok: true } });

    await withServer(async baseUrl => {
        const summary = await fetch(`${baseUrl}/api/traces/${runId}`);
        assert.equal(summary.status, 200);
        const summaryBody = await summary.json();
        assert.equal(summaryBody.ok, true);
        assert.equal(summaryBody.data.id, runId);

        const events = await fetch(`${baseUrl}/api/traces/${runId}/events?limit=500`);
        assert.equal(events.status, 200);
        const eventsBody = await events.json();
        assert.equal(eventsBody.data.total, 1);
        assert.equal(eventsBody.data.events.length, 1);
    });
});

test('trace routes hide internal traces as not found', async () => {
    const runId = startTraceRun({ cli: 'copilot', audience: 'internal' });
    appendTraceEvent({ runId, source: 'acp_raw', eventType: 'secret', raw: { text: 'internal' } });

    await withServer(async baseUrl => {
        const response = await fetch(`${baseUrl}/api/traces/${runId}`);
        assert.equal(response.status, 404);
        const body = await response.json();
        assert.equal(body.ok, false);
        assert.equal(body.error, 'trace_not_found');
    });
});

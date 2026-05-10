import crypto from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { settings, saveSettings } from '../core/config.js';
import { JawCeoCoordinator, type JawCeoCoordinatorDeps } from '../jaw-ceo/coordinator.js';
import { extractOpenAiApiKey, hasInvalidOpenAiApiKeyInput, resolveJawCeoOpenAiApiKey } from '../jaw-ceo/openai-key.js';
import { buildJawCeoRealtimeSessionConfig, JAW_CEO_REALTIME_MODEL, JAW_CEO_REALTIME_VOICE, openJawCeoRealtimeSideband } from '../jaw-ceo/realtime-sideband.js';
import type { JawCeoManagerEvent, JawCeoResponseMode } from '../jaw-ceo/types.js';

export type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void;

export type JawCeoRouteDeps = JawCeoCoordinatorDeps & {
    coordinator?: JawCeoCoordinator;
    openAiApiKey?: string;
    fetchImpl?: typeof fetch;
};

function ok(res: Response, data: unknown): void {
    res.json({ ok: true, data });
}

function fail(res: Response, status: number, code: string, message: string, extra: Record<string, unknown> = {}): void {
    res.status(status).json({ ok: false, code, error: message, message, ...extra });
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void> | void): RequestHandler {
    return (req, res) => {
        void Promise.resolve(handler(req, res)).catch(error => {
            fail(res, Number((error as { statusCode?: number }).statusCode || 500), (error as { code?: string }).code || 'jaw_ceo_internal_error', (error as Error).message);
        });
    };
}

function parseCompletionKey(req: Request): string {
    return String(req.params["completionKey"] || '').trim();
}

function parseCallId(location: string | null): string | null {
    if (!location) return null;
    const clean = location.split('?')[0] || location;
    return clean.split('/').filter(Boolean).pop() || null;
}

function stableSafetyIdentifier(req: Request): string {
    const raw = `${req.ip || req.socket.remoteAddress || 'local'}:${req.headers['user-agent'] || 'dashboard'}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
}

type RouteContext = {
    router: express.Router;
    coordinator: JawCeoCoordinator;
    fetchImpl: typeof fetch;
    openAiApiKeyOverride: string;
};

function body(req: Request): Record<string, unknown> {
    return req.body as Record<string, unknown>;
}

function resolveOpenAiApiKey(ctx: RouteContext) {
    return resolveJawCeoOpenAiApiKey({
        override: ctx.openAiApiKeyOverride,
        env: process.env["OPENAI_API_KEY"],
        settings: settings["jawCeo"]?.openaiApiKey,
    });
}

function publicVoiceSettings(ctx: RouteContext): Record<string, unknown> {
    const key = resolveOpenAiApiKey(ctx);
    const savedKey = settings["jawCeo"]?.openaiApiKey;
    return {
        openaiKeySet: !!key.value,
        openaiKeyLast4: key.value.slice(-4) || '',
        openaiKeySource: key.source,
        openaiKeyInvalid: hasInvalidOpenAiApiKeyInput(savedKey),
        model: JAW_CEO_REALTIME_MODEL,
        voice: JAW_CEO_REALTIME_VOICE,
    };
}

function refreshVoiceAvailability(ctx: RouteContext): void {
    const key = resolveOpenAiApiKey(ctx);
    const current = ctx.coordinator.store.getState().voice;
    if (current.status === 'active' || current.status === 'connecting' || current.status === 'silent' || current.status === 'paused') return;
    if (!key.value && current.status !== 'disabled') {
        ctx.coordinator.store.updateVoice({ status: 'disabled', error: 'OPENAI_API_KEY is not configured' });
        return;
    }
    if (key.value && current.status === 'disabled') {
        ctx.coordinator.store.updateVoice({ status: 'idle', error: null });
    }
}

function registerCoreRoutes(ctx: RouteContext): void {
    ctx.router.get('/state', (_req, res) => {
        refreshVoiceAvailability(ctx);
        ok(res, ctx.coordinator.state());
    });
    ctx.router.post('/message', asyncRoute(async (req, res) => {
        const input = body(req);
        const result = await ctx.coordinator.message({
            ...(typeof input["sessionId"] === 'string' ? { sessionId: input["sessionId"] } : {}),
            inputMode: input["inputMode"] === 'voice' ? 'voice' : 'text',
            responseMode: input["responseMode"] === 'voice' || input["responseMode"] === 'both' || input["responseMode"] === 'silent' ? input["responseMode"] : 'text',
            text: String(input["text"] || ''),
            ...(input["selectedPort"] === null || Number.isInteger(Number(input["selectedPort"])) ? { selectedPort: input["selectedPort"] === null ? null : Number(input["selectedPort"]) } : {}),
        });
        ok(res, result);
    }));
    ctx.router.post('/query', asyncRoute(async (req, res) => {
        const input = body(req);
        const source = input["source"] === 'cli_readonly' || input["source"] === 'web' || input["source"] === 'github_read' ? input["source"] : 'dashboard';
        const result = await ctx.coordinator.query({
            source,
            query: String(input["query"] || ''),
            ...(Number.isInteger(Number(input["port"])) ? { port: Number(input["port"]) } : {}),
            ...(Number.isInteger(Number(input["limit"])) ? { limit: Number(input["limit"]) } : {}),
        });
        ok(res, result);
    }));
    ctx.router.post('/docs/edit', asyncRoute(async (req, res) => {
        const input = body(req);
        const operation = input["operation"] === 'replace_section' || input["operation"] === 'apply_patch' ? input["operation"] : 'append_section';
        ok(res, await ctx.coordinator.editDocs({
            path: String(input["path"] || ''),
            operation,
            content: String(input["content"] || ''),
            reason: String(input["reason"] || 'Jaw CEO docs edit'),
        }));
    }));
}

function registerSettingsRoutes(ctx: RouteContext): void {
    ctx.router.get('/settings', (_req, res) => {
        refreshVoiceAvailability(ctx);
        ok(res, publicVoiceSettings(ctx));
    });
    ctx.router.put('/settings', asyncRoute((req, res) => {
        const input = body(req);
        const jawCeo = { ...(settings["jawCeo"] || {}) };
        if (input["clearOpenAiApiKey"] === true) {
            jawCeo.openaiApiKey = '';
        } else if (typeof input["openaiApiKey"] === 'string' && input["openaiApiKey"].trim()) {
            const key = extractOpenAiApiKey(input["openaiApiKey"]);
            if (!key) {
                fail(res, 400, 'invalid_openai_api_key', 'Paste a valid OpenAI API key that starts with sk-.');
                return;
            }
            jawCeo.openaiApiKey = key;
        }
        settings["jawCeo"] = jawCeo;
        saveSettings(settings);
        refreshVoiceAvailability(ctx);
        ok(res, publicVoiceSettings(ctx));
    }));
}

function registerEventRoutes(ctx: RouteContext): void {
    ctx.router.post('/events/ingest', asyncRoute((req, res) => {
        const input = body(req);
        const events = Array.isArray(input["events"]) ? input["events"] as JawCeoManagerEvent[] : [input as JawCeoManagerEvent];
        const results = events.map(event => ctx.coordinator.ingestManagerEvent(event));
        ok(res, { created: results.filter(result => result.ok && result.completion).length, results });
    }));
    ctx.router.post('/events/refresh', asyncRoute(async (req, res) => {
        const input = body(req);
        const ports = Array.isArray(input["ports"]) ? input["ports"].map(Number).filter(port => Number.isInteger(port)) : undefined;
        const events = Array.isArray(input["events"]) ? input["events"] as JawCeoManagerEvent[] : undefined;
        const result = await ctx.coordinator.refreshEvents({
            ...(ports !== undefined ? { ports } : {}),
            ...(events !== undefined ? { events } : {}),
            ...(typeof input["sinceCursor"] === 'string' ? { sinceCursor: input["sinceCursor"] } : {}),
        });
        ok(res, result);
    }));
}

function registerPendingRoutes(ctx: RouteContext): void {
    ctx.router.get('/pending', (req, res) => {
        const status = typeof req.query["status"] === 'string' ? req.query["status"] : undefined;
        ok(res, ctx.coordinator.store.listPending(status === 'pending' || status === 'spoken' || status === 'acknowledged' || status === 'dismissed' ? status : undefined));
    });
    ctx.router.post('/pending/:completionKey/continue', (req, res) => {
        const rawMode = body(req)["mode"];
        const mode = rawMode === 'voice' || rawMode === 'both' || rawMode === 'silent' ? rawMode : 'text';
        ok(res, ctx.coordinator.continueCompletion(parseCompletionKey(req), mode));
    });
    ctx.router.post('/pending/:completionKey/summarize', (req, res) => {
        ok(res, ctx.coordinator.summarizeCompletion(parseCompletionKey(req), body(req)["format"] === 'detailed' ? 'detailed' : 'short'));
    });
    ctx.router.post('/pending/:completionKey/ack', (req, res) => ok(res, ctx.coordinator.updatePendingStatus(parseCompletionKey(req), 'acknowledged')));
    ctx.router.post('/pending/:completionKey/dismiss', (req, res) => ok(res, ctx.coordinator.updatePendingStatus(parseCompletionKey(req), 'dismissed')));
}

function registerWatchAuditRoutes(ctx: RouteContext): void {
    ctx.router.post('/watch', asyncRoute(async (req, res) => {
        const input = body(req);
        const fallback = input["latestMessageFallback"] && typeof input["latestMessageFallback"] === 'object'
            ? input["latestMessageFallback"] as { mode?: unknown; sinceMessageId?: unknown; postWatchFingerprint?: unknown }
            : {};
        const mode = fallback.mode === 'enabled' || fallback.mode === 'requires_post_watch_proof' ? fallback.mode : 'disabled';
        const reason = input["reason"] === 'voice_started_task' || input["reason"] === 'manual_watch' ? input["reason"] : 'ceo_routed_task';
        ok(res, await ctx.coordinator.watchCompletion({
            port: Number(input["port"]),
            dispatchRef: String(input["dispatchRef"] || `dispatch_${crypto.randomUUID()}`),
            reason,
            latestMessageFallback: {
                mode,
                ...(Number.isInteger(Number(fallback.sinceMessageId)) ? { sinceMessageId: Number(fallback.sinceMessageId) } : {}),
                ...(typeof fallback.postWatchFingerprint === 'string' ? { postWatchFingerprint: fallback.postWatchFingerprint } : {}),
            },
            ...(typeof input["sessionId"] === 'string' ? { sessionId: input["sessionId"] } : {}),
            ...(typeof input["autoRead"] === 'boolean' ? { autoRead: input["autoRead"] } : {}),
        }));
    }));
    ctx.router.get('/audit', (req, res) => {
        const limit = Number.isInteger(Number(req.query["limit"])) ? Number(req.query["limit"]) : 50;
        const kind = typeof req.query["kind"] === 'string' ? req.query["kind"] : undefined;
        const port = Number.isInteger(Number(req.query["port"])) ? Number(req.query["port"]) : undefined;
        ok(res, ctx.coordinator.store.listAudit(limit, {
            ...(kind === 'tool' || kind === 'policy' || kind === 'lifecycle' || kind === 'completion' || kind === 'docs_edit' ? { kind } : {}),
            ...(port !== undefined ? { port } : {}),
        }));
    });
}

function registerVoiceRoutes(ctx: RouteContext): void {
    ctx.router.post('/voice/connect', asyncRoute(async (req, res) => {
        const input = body(req);
        const offerSdp = String(input["offerSdp"] || '');
        if (!validateVoiceRequest(ctx, res, offerSdp)) return;
        const sessionId = typeof input["sessionId"] === 'string' && input["sessionId"] ? input["sessionId"] : ctx.coordinator.store.getSession().sessionId;
        const selectedPort = input["selectedPort"] === null ? null : Number.isInteger(Number(input["selectedPort"])) ? Number(input["selectedPort"]) : null;
        ctx.coordinator.updatePresence({ selectedPort, frontendPresence: 'active' });
        await connectVoice(ctx, req, res, { offerSdp, sessionId });
    }));
    ctx.router.post('/voice/:sessionId/close', (req, res) => ok(res, ctx.coordinator.closeVoiceSession(String(req.params["sessionId"] || ''))));
}

function validateVoiceRequest(ctx: RouteContext, res: Response, offerSdp: string): boolean {
    if (!offerSdp.trim()) {
        fail(res, 400, 'voice_offer_required', 'offerSdp is required');
        return false;
    }
    if (resolveOpenAiApiKey(ctx).value) return true;
    ctx.coordinator.store.updateVoice({ status: 'disabled', error: 'OPENAI_API_KEY is not configured' });
    fail(res, 503, 'voice_disabled', 'OPENAI_API_KEY is not configured');
    return false;
}

async function connectVoice(ctx: RouteContext, req: Request, res: Response, args: { offerSdp: string; sessionId: string }): Promise<void> {
    const apiKey = resolveOpenAiApiKey(ctx).value;
    ctx.coordinator.store.updateVoice({ status: 'connecting', error: null });
    const form = new FormData();
    form.set('sdp', args.offerSdp);
    form.set('session', JSON.stringify(buildJawCeoRealtimeSessionConfig('manage')));
    const response = await ctx.fetchImpl('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'OpenAI-Safety-Identifier': stableSafetyIdentifier(req) },
        body: form,
    });
    const answerSdp = await response.text();
    if (!handleVoiceResponse(ctx, res, response, answerSdp)) return;
    const callId = parseCallId(response.headers.get('Location'));
    if (!callId) {
        ctx.coordinator.store.updateVoice({ status: 'error', error: 'OpenAI Realtime response did not include Location call id' });
        fail(res, 502, 'voice_call_id_missing', 'OpenAI Realtime response did not include Location call id');
        return;
    }
    ctx.coordinator.registerVoiceSession(openJawCeoRealtimeSideband({ sessionId: args.sessionId, callId, coordinator: ctx.coordinator, apiKey }));
    ok(res, { sessionId: args.sessionId, answerSdp, model: JAW_CEO_REALTIME_MODEL, voice: JAW_CEO_REALTIME_VOICE });
}

function handleVoiceResponse(ctx: RouteContext, res: Response, response: globalThis.Response, answerSdp: string): boolean {
    if (response.ok) return true;
    ctx.coordinator.store.updateVoice({ status: 'error', error: answerSdp || `Realtime call failed: ${response.status}` });
    fail(res, response.status, 'voice_connect_failed', answerSdp || `Realtime call failed: ${response.status}`);
    return false;
}

function registerConfirmationRoutes(ctx: RouteContext): void {
    ctx.router.post('/confirmations', (req, res) => {
        const input = body(req);
        ok(res, ctx.coordinator.createConfirmation({
            action: String(input["action"] || ''),
            ...(Number.isInteger(Number(input["targetPort"])) ? { targetPort: Number(input["targetPort"]) } : {}),
            ...(typeof input["sessionId"] === 'string' ? { sessionId: input["sessionId"] } : {}),
            ...(typeof input["argsHash"] === 'string' ? { argsHash: input["argsHash"] } : {}),
            ...(Number.isInteger(Number(input["expiresInMs"])) ? { expiresInMs: Number(input["expiresInMs"]) } : {}),
        }));
    });
    ctx.router.post('/confirmations/:confirmationId/confirm', (req, res) => {
        const input = body(req);
        ok(res, ctx.coordinator.confirmConfirmation(String(req.params["confirmationId"] || ''), {
            ...(typeof input["sessionId"] === 'string' ? { sessionId: input["sessionId"] } : {}),
            ...(typeof input["reason"] === 'string' ? { reason: input["reason"] } : {}),
        }));
    });
    ctx.router.post('/confirmations/:confirmationId/cancel', (req, res) => {
        const input = body(req);
        ok(res, ctx.coordinator.cancelConfirmation(String(req.params["confirmationId"] || ''), typeof input["reason"] === 'string' ? input["reason"] : undefined));
    });
}

export function createJawCeoRouter(deps: JawCeoRouteDeps): express.Router {
    const router = express.Router();
    const coordinator = deps.coordinator || new JawCeoCoordinator(deps);
    const ctx = { router, coordinator, fetchImpl: deps.fetchImpl || fetch, openAiApiKeyOverride: deps.openAiApiKey ?? '' };
    registerCoreRoutes(ctx);
    registerSettingsRoutes(ctx);
    registerEventRoutes(ctx);
    registerPendingRoutes(ctx);
    registerWatchAuditRoutes(ctx);
    registerVoiceRoutes(ctx);
    registerConfirmationRoutes(ctx);

    return router;
}

export function registerJawCeoRoutes(app: Express, requireAuth: AuthMiddleware, deps: JawCeoRouteDeps): void {
    app.use('/api/jaw-ceo', requireAuth, createJawCeoRouter(deps));
}

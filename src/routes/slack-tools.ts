import type { SlackSearchChannelType } from '../slack/search.js';
import type { Express, Request } from 'express';
import type { AuthMiddleware } from './types.js';
import { getSlackSendClient } from '../slack/send-only-client.js';
import { resolveSlackToolPrincipal, withSlackToolAccess, slackToolDenied, type SlackOperatorValidator } from '../slack/tool-access.js';
import { readSlackMessageSnapshot, type SlackMessagePointer } from '../slack/message.js';
import { slackHistoryForAgent } from '../slack/history.js';
import { readSlackSearchInfo } from '../slack/search.js';
import { searchAndQuoteSlack } from '../slack/search-quote.js';
import { publishSlackQuote, runSlackQuoteInvocation } from '../slack/quote.js';
import { slackTargetFromId } from '../messaging/slack-target.js';
import { httpStatus, httpCode } from './_http-error.js';
import { slackAction, slackActions } from '../slack/actions.js';
import type { SlackActionRuntime } from '../slack/action-runtime.js';
import type { SlackActionStore } from '../slack/action-store.js';
import { slackToolCapabilities } from '../slack/tool-capabilities.js';

type Task = { operation: string; source?: SlackMessagePointer; invocationId?: string; excerpt?: string; summary?: string;
    destination?: { channel: string; threadTs?: string }; query?: string; channelTypes?: SlackSearchChannelType[]; maxQuotes?: number; maxPages?: number; before?: number; after?: number; sort?: 'score' | 'timestamp'; sortDir?: 'asc' | 'desc' };
function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw slackToolDenied('invalid_slack_task', 400);
    return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, keys: string[]): void {
    if (Object.keys(value).some(key => !keys.includes(key))) throw slackToolDenied('invalid_slack_task_fields', 400);
}
function text(value: unknown, max: number): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw slackToolDenied('invalid_slack_task_string', 400);
    return value;
}
function channel(value: unknown): string { const result = text(value, 64); if (result !== result.trim() || !/^[CGD][A-Z0-9]+$/.test(result)) throw slackToolDenied('invalid_slack_channel', 400); return result; }
function timestamp(value: unknown): string { const result = text(value, 24); if (result !== result.trim() || !/^\d{1,13}\.\d{1,6}$/.test(result)) throw slackToolDenied('invalid_slack_timestamp', 400); return result; }
function parseTask(raw: unknown): Task {
    const data = record(raw); const operation = text(data['operation'], 32);
    if (!['message', 'permalink', 'quote', 'search.info', 'search.quote'].includes(operation)) throw slackToolDenied('unsupported_slack_operation', 400);
    const keys = operation === 'search.info' ? ['operation'] : operation === 'search.quote'
        ? ['operation', 'invocationId', 'query', 'channelTypes', 'maxQuotes', 'maxPages', 'before', 'after', 'sort', 'sortDir']
        : operation === 'quote' ? ['operation', 'source', 'invocationId', 'excerpt', 'summary', 'destination'] : ['operation', 'source'];
    only(data, keys);
    const result: Task = { operation };
    if (operation === 'quote' || operation === 'search.quote') {
        result.invocationId = text(data['invocationId'], 64);
        if (result.invocationId !== result.invocationId.trim() || !/^[A-Za-z0-9_-]+$/.test(result.invocationId)) throw slackToolDenied('invalid_slack_invocation_id', 400);
    }
    if (['message', 'permalink', 'quote'].includes(operation)) {
        const source = record(data['source']); only(source, ['channel', 'ts', 'threadTs']);
        result.source = { channel: channel(source['channel']), ts: timestamp(source['ts']), ...(source['threadTs'] !== undefined ? { threadTs: timestamp(source['threadTs']) } : {}) };
    }
    if (data['destination'] !== undefined) {
        const destination = record(data['destination']); only(destination, ['channel', 'threadTs']);
        result.destination = { channel: channel(destination['channel']), ...(destination['threadTs'] !== undefined ? { threadTs: timestamp(destination['threadTs']) } : {}) };
    }
    if (data['excerpt'] !== undefined) result.excerpt = text(data['excerpt'], 2500);
    if (data['summary'] !== undefined) result.summary = text(data['summary'], 2500);
    if (result.summary && result.excerpt) throw slackToolDenied('slack_quote_mode_conflict', 400);
    if (operation === 'search.quote') {
        result.query = text(data['query'], 2000);
        if (data['channelTypes'] !== undefined) {
            const kinds = data['channelTypes'];
            if (!Array.isArray(kinds) || !kinds.length || kinds.length > 4 || kinds.some(kind => typeof kind !== 'string' || !['public_channel', 'private_channel', 'im', 'mpim'].includes(kind))) throw slackToolDenied('invalid_slack_search_scope', 400);
            result.channelTypes = [...new Set(kinds)] as SlackSearchChannelType[];
        }
        for (const key of ['maxQuotes', 'maxPages', 'before', 'after'] as const) {
            if (data[key] === undefined) continue;
            const value = data[key];
            const max = key === 'maxQuotes' ? 5 : key === 'maxPages' ? 3 : 8640000000000;
            if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw slackToolDenied('invalid_slack_task_number', 400);
            result[key] = value;
        }
        if (data['sort'] !== undefined) { if (typeof data['sort'] !== 'string' || !['score', 'timestamp'].includes(data['sort'])) throw slackToolDenied('invalid_slack_sort', 400); result.sort = data['sort'] as 'score' | 'timestamp'; }
        if (data['sortDir'] !== undefined) { if (typeof data['sortDir'] !== 'string' || !['asc', 'desc'].includes(data['sortDir'])) throw slackToolDenied('invalid_slack_sort', 400); result.sortDir = data['sortDir'] as 'asc' | 'desc'; }
        if (result.before && result.after && result.after >= result.before) throw slackToolDenied('invalid_slack_time_range', 400);
    }
    return result;
}
export function registerSlackToolRoutes(app: Express, requireAuth: AuthMiddleware, validateOperator: SlackOperatorValidator,
    actions?: { runtime: SlackActionRuntime; store: SlackActionStore; inboundReady(): boolean }): void {
    if (actions) app.get('/api/slack/tools/capabilities', requireAuth, async (req, res) => {
        try {
            const principal = req.headers['x-jaw-slack-grant'] !== undefined || req.headers['x-jaw-slack-operator'] !== undefined
                ? resolveSlackToolPrincipal(req.headers, validateOperator) : null;
            res.json(await slackToolCapabilities(getSlackSendClient().token, slackActions, principal, actions.store, { inboundReady: actions.inboundReady() }));
        } catch (error) {
            res.status(httpStatus(error, 502)).json({ ok: false, error: httpCode(error) ?? 'slack_tool_failed', retryable: false });
        }
    });
    app.post('/api/slack/tools', requireAuth, async (req: Request, res) => {
        try {
            const raw = record(req.body);
            const action = slackAction(raw['operation']);
            const task = action ? undefined : parseTask(raw);
            const principal = resolveSlackToolPrincipal(req.headers, validateOperator);
            if (action) {
                if (!actions) throw slackToolDenied('slack_action_store_unavailable', 503);
                const controller = new AbortController();
                const aborted = () => controller.abort();
                const closed = () => { if (!res.writableEnded) controller.abort(); };
                req.once('aborted', aborted); res.once('close', closed);
                try {
                    const receipt = await actions.runtime.execute(action, raw, principal, controller.signal);
                    res.status(receipt.ok ? 200 : receipt.status ?? 502).json(receipt);
                } finally { req.off('aborted', aborted); res.off('close', closed); }
                return;
            }
            if (!task) throw slackToolDenied('unsupported_slack_operation', 400);
            const client = getSlackSendClient();
            if (!client.token) throw slackToolDenied('slack_unavailable', 503);
            const token = client.token;
            const callOptions = { currentCredential: () => getSlackSendClient().token, ...(principal.kind === 'turn' ? { signal: principal.grant.signal } : {}) };
            let result: unknown;
            if (task.operation === 'search.quote') {
                const { operation: _operation, ...search } = task;
                result = await searchAndQuoteSlack(token, principal, { ...search, query: task.query!, invocationId: task.invocationId! }, callOptions);
            } else if (task.operation === 'quote') {
                result = await runSlackQuoteInvocation(token, principal, task.invocationId!, task, () => publishSlackQuote(token, principal, {
                    source: task.source!, ...(task.excerpt !== undefined ? { excerpt: task.excerpt } : {}),
                    ...(task.summary !== undefined ? { summary: task.summary } : {}),
                    ...(task.destination ? { destination: slackTargetFromId(task.destination['channel'], task.destination['threadTs'] ? { threadTs: task.destination['threadTs'] } : {}) } : {}),
                }, callOptions));
            } else {
                result = await withSlackToolAccess(token, principal, task.source?.channel, async signal => {
                    const options = { currentCredential: () => getSlackSendClient().token, ...(signal ? { signal } : {}) };
                    if (options.currentCredential() !== token) throw slackToolDenied('slack_credential_changed', 409);
                    if (task.operation === 'search.info') {
                        const info = await readSlackSearchInfo(token, options);
                        if (options.currentCredential() !== token) throw slackToolDenied('slack_credential_changed', 409);
                        return info;
                    }
                    const snapshot = await readSlackMessageSnapshot(token, task.source!, options);
                    if (options.currentCredential() !== token) throw slackToolDenied('slack_credential_changed', 409);
                    return task.operation === 'permalink' ? { ok: true, permalink: snapshot.permalink }
                        : { ok: true, message: slackHistoryForAgent([snapshot.message])[0], permalink: snapshot.permalink };
                });
            }
            const failed = result && typeof result === 'object' && (result as { ok?: unknown }).ok === false;
            res.status(failed ? 502 : 200).json(result);
        } catch (error) {
            const code = httpCode(error);
            res.status(httpStatus(error, 502)).json({ ok: false, error: typeof code === 'string' ? code : 'slack_tool_failed', retryable: false });
        }
    });
}

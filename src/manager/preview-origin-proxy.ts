import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import {
    MANAGED_INSTANCE_HOST,
} from './constants.js';
import {
    sanitizeProxyResponseHeaders,
    targetOriginForPort,
    rewriteUpstreamRequestHeaders,
    buildProxyUpgradeRequest,
} from './proxy.js';
import {
    assertRangeDoesNotContainPort,
    assertRangesDoNotOverlap,
    assertValidPortRange,
    isExpectedHostHeader,
    isPortInRange,
    isAllowedOriginHeader,
    toPortRange,
    type PortRange,
} from './security.js';
import type { DashboardOriginPreviewProxyInfo, DashboardPreviewProxyInstance } from './types.js';

export type PreviewOriginProxyOptions = {
    scanFrom: number;
    scanCount: number;
    previewFrom: number;
    managerPort: number;
    bindHost?: '127.0.0.1';
    requestTimeoutMs?: number;
};

export type PreviewOriginProxyRange = {
    targetFrom: number;
    targetTo: number;
    previewFrom: number;
    previewTo: number;
};

export type PreviewOriginProxyController = {
    range: PreviewOriginProxyRange;
    validate(): void;
    ensureTarget(targetPort: number): Promise<void>;
    reconcileOnlineTargets(targetPorts: number[]): Promise<void>;
    snapshot(): DashboardOriginPreviewProxyInfo;
    close(): Promise<void>;
};

type PreviewServerState = DashboardPreviewProxyInstance & {
    server: http.Server | null;
    sockets: Set<Socket>;
};

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char] || char));
}

function diagnosticHtml(reason: string): string {
    return `<!doctype html><title>Preview unavailable</title><body><main><h1>Preview unavailable</h1><p>The preview proxy could not reach this managed instance.</p><p>${escapeHtml(reason)}</p><p>Use Open in a new tab or try again after the instance is online.</p></main></body>`;
}

function sendDiagnostic(res: ServerResponse, status: number, reason: string): void {
    if (res.headersSent) {
        res.end();
        return;
    }
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    res.end(diagnosticHtml(reason));
}

export function previewPortForTargetPort(targetPort: number, range: PreviewOriginProxyRange): number {
    return range.previewFrom + (targetPort - range.targetFrom);
}

export function targetPortForPreviewPort(previewPort: number, range: PreviewOriginProxyRange): number {
    return range.targetFrom + (previewPort - range.previewFrom);
}

export function validatePreviewOriginProxyOptions(options: PreviewOriginProxyOptions): PreviewOriginProxyRange {
    const targetRange = toPortRange(options.scanFrom, options.scanCount);
    const previewRange = toPortRange(options.previewFrom, options.scanCount);
    assertValidPortRange(targetRange, 'scan');
    assertValidPortRange(previewRange, 'preview');
    assertRangeDoesNotContainPort(targetRange, options.managerPort, 'scan range');
    assertRangeDoesNotContainPort(previewRange, options.managerPort, 'preview range');
    assertRangesDoNotOverlap(targetRange, previewRange, 'scan and preview');
    return {
        targetFrom: targetRange.from,
        targetTo: targetRange.to,
        previewFrom: previewRange.from,
        previewTo: previewRange.to,
    };
}

function isAbsoluteProxyUrl(path: string): boolean {
    return /^https?:\/\//i.test(path) || path.startsWith('//');
}

export function createPreviewOriginProxyController(
    options: PreviewOriginProxyOptions,
): PreviewOriginProxyController {
    const bindHost = options.bindHost || '127.0.0.1';
    const timeoutMs = options.requestTimeoutMs || 5_000;
    const range = validatePreviewOriginProxyOptions(options);
    const targetRange: PortRange = { from: range.targetFrom, to: range.targetTo };
    const states = new Map<number, PreviewServerState>();
    let closing = false;

    for (let port = range.targetFrom; port <= range.targetTo; port += 1) {
        const previewPort = previewPortForTargetPort(port, range);
        states.set(port, {
            targetPort: port,
            previewPort,
            url: `http://${bindHost}:${previewPort}/`,
            status: 'unavailable',
            reason: 'target-offline',
            server: null,
            sockets: new Set(),
        });
    }

    function publicBase(state: PreviewServerState): string {
        return `http://${bindHost}:${state.previewPort}`;
    }

    function validateIncoming(req: IncomingMessage, state: PreviewServerState): { ok: true } | { ok: false; status: number; reason: string } {
        if (!isExpectedHostHeader(req.headers.host, {
            host: bindHost,
            port: state.previewPort,
            allowLocalhostAlias: true,
        })) {
            return { ok: false, status: 403, reason: 'unexpected preview host header' };
        }
        const previewOrigins = [
            publicBase(state),
            `http://localhost:${state.previewPort}`,
            `http://${bindHost}:${options.managerPort}`,
            `http://localhost:${options.managerPort}`,
        ];
        if (!isAllowedOriginHeader(req.headers.origin, {
            allowedOrigins: previewOrigins,
            allowMissing: true,
        })) {
            return { ok: false, status: 403, reason: 'unexpected preview origin header' };
        }
        const path = req.url || '/';
        if (!path.startsWith('/') || isAbsoluteProxyUrl(path)) {
            return { ok: false, status: 400, reason: 'unsafe preview path' };
        }
        return { ok: true };
    }

    function handleHttp(req: IncomingMessage, res: ServerResponse, state: PreviewServerState): void {
        const validation = validateIncoming(req, state);
        if (!validation.ok) {
            sendDiagnostic(res, validation.status, validation.reason);
            return;
        }

        const upstream = http.request({
            hostname: MANAGED_INSTANCE_HOST,
            port: state.targetPort,
            method: req.method,
            path: req.url || '/',
            headers: rewriteUpstreamRequestHeaders(req.headers, state.targetPort),
            timeout: timeoutMs,
        }, (upstreamRes) => {
            const headers = sanitizeProxyResponseHeaders(upstreamRes.headers, {
                targetOrigin: targetOriginForPort(state.targetPort),
                publicBase: publicBase(state),
            });
            headers['x-jaw-preview-proxy'] = 'origin-port';
            headers['x-jaw-preview-port'] = String(state.previewPort);
            headers['x-jaw-target-port'] = String(state.targetPort);
            res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage, headers);
            upstreamRes.pipe(res);
        });

        upstream.on('timeout', () => {
            upstream.destroy(new Error('preview proxy timeout'));
        });
        upstream.on('error', (error: Error) => {
            sendDiagnostic(res, error.message === 'preview proxy timeout' ? 504 : 502, error.message);
        });
        req.pipe(upstream);
    }

    function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, state: PreviewServerState): void {
        const validation = validateIncoming(req, state);
        if (!validation.ok) {
            socket.write(`HTTP/1.1 ${validation.status} ${validation.reason}\r\nConnection: close\r\n\r\n`);
            socket.destroy();
            return;
        }
        let connected = false;
        const upstream = net.connect(state.targetPort, MANAGED_INSTANCE_HOST, () => {
            connected = true;
            clearTimeout(connectTimer);
            upstream.write(buildProxyUpgradeRequest(req, req.url || '/', state.targetPort));
            if (head.length) upstream.write(head);
            socket.pipe(upstream).pipe(socket);
        });
        const connectTimer = setTimeout(() => upstream.destroy(new Error('preview websocket connect timeout')), timeoutMs);
        upstream.on('close', () => clearTimeout(connectTimer));
        upstream.on('error', () => {
            if (!connected) socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
            socket.destroy();
        });
    }

    async function closeState(state: PreviewServerState, reason = 'target-offline'): Promise<void> {
        const server = state.server;
        if (!server) {
            state.status = 'unavailable';
            state.reason = reason;
            return;
        }
        state.server = null;
        state.status = 'unavailable';
        state.reason = reason;
        for (const socket of state.sockets) socket.destroy();
        state.sockets.clear();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }

    async function bindState(state: PreviewServerState): Promise<void> {
        if (state.server || closing) return;
        const server = http.createServer((req, res) => handleHttp(req, res, state));
        server.on('connection', socket => {
            state.sockets.add(socket);
            socket.on('close', () => state.sockets.delete(socket));
        });
        server.on('upgrade', (req, socket, head) => handleUpgrade(req, socket, head, state));
        await new Promise<void>(resolve => {
            server.once('error', (error: NodeJS.ErrnoException) => {
                state.status = 'unavailable';
                state.reason = error.code || error.message;
                state.server = null;
                resolve();
            });
            server.listen(state.previewPort, bindHost, () => {
                state.server = server;
                state.status = 'ready';
                state.reason = null;
                resolve();
            });
        });
    }

    return {
        range,
        validate(): void {
            validatePreviewOriginProxyOptions(options);
        },
        async ensureTarget(targetPort: number): Promise<void> {
            if (!isPortInRange(targetPort, targetRange)) throw new Error('target port outside preview range');
            const state = states.get(targetPort);
            if (!state) throw new Error('preview state missing');
            await bindState(state);
        },
        async reconcileOnlineTargets(targetPorts: number[]): Promise<void> {
            const online = new Set(targetPorts.filter(port => isPortInRange(port, targetRange)));
            await Promise.all([...states.values()].map(async state => {
                if (online.has(state.targetPort)) {
                    await bindState(state);
                    return;
                }
                await closeState(state);
            }));
        },
        snapshot(): DashboardOriginPreviewProxyInfo {
            const instances: Record<string, DashboardPreviewProxyInstance> = {};
            for (const [targetPort, state] of states) {
                instances[String(targetPort)] = {
                    targetPort,
                    previewPort: state.previewPort,
                    url: state.url,
                    status: state.status,
                    reason: state.reason,
                };
            }
            return { enabled: true, kind: 'origin-port', previewFrom: range.previewFrom, previewTo: range.previewTo, instances };
        },
        async close(): Promise<void> {
            if (closing) return;
            closing = true;
            await Promise.all([...states.values()].map(state => closeState(state, 'closed')));
        },
    };
}

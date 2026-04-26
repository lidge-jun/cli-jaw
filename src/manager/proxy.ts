import type { Express, Request, Response } from 'express';
import type { IncomingMessage, Server } from 'node:http';
import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import {
    MANAGED_INSTANCE_HOST,
    MANAGED_INSTANCE_PORT_COUNT,
    MANAGED_INSTANCE_PORT_FROM,
} from './constants.js';

export type DashboardProxyOptions = {
    from?: number;
    count?: number;
};

export type ProxyPortRange = {
    from: number;
    to: number;
};

type ParsedProxyUrl = {
    ok: true;
    port: number;
    targetPath: string;
} | {
    ok: false;
    status: number;
    reason: string;
};

function positiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function dashboardProxyRange(options: DashboardProxyOptions = {}): ProxyPortRange {
    const from = positiveInt(options.from, MANAGED_INSTANCE_PORT_FROM);
    const count = positiveInt(options.count, MANAGED_INSTANCE_PORT_COUNT);
    return { from, to: from + Math.max(1, count) - 1 };
}

export function isDashboardProxyPortAllowed(port: number, range: ProxyPortRange): boolean {
    return Number.isInteger(port) && port >= range.from && port <= range.to;
}

function safeDecodePath(path: string): string | null {
    try {
        return decodeURIComponent(path);
    } catch {
        return null;
    }
}

export function isUnsafeProxyPath(targetPath: string): boolean {
    if (!targetPath.startsWith('/')) return true;
    if (/%2f/i.test(targetPath) || /%5c/i.test(targetPath)) return true;

    const decoded = safeDecodePath(targetPath);
    if (!decoded) return true;
    if (decoded.includes('\\')) return true;

    const pathname = decoded.split(/[?#]/, 1)[0] || '/';
    return pathname.split('/').some(segment => segment === '..');
}

export function parseDashboardProxyUrl(originalUrl: string, range: ProxyPortRange): ParsedProxyUrl {
    const match = originalUrl.match(/^\/i\/(\d+)(\/.*)?$/);
    if (!match) return { ok: false, status: 404, reason: 'proxy route not found' };

    const port = Number(match[1]);
    if (!isDashboardProxyPortAllowed(port, range)) {
        return { ok: false, status: 403, reason: 'proxy port is outside the allowed dashboard range' };
    }

    const targetPath = match[2] || '/';
    if (isUnsafeProxyPath(targetPath)) {
        return { ok: false, status: 400, reason: 'unsafe proxy path' };
    }

    return { ok: true, port, targetPath };
}

function sanitizeResponseHeaders(headers: http.IncomingHttpHeaders, port: number): http.OutgoingHttpHeaders {
    const next: http.OutgoingHttpHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase();
        if (lower === 'x-frame-options' || lower === 'content-security-policy') continue;
        if (lower === 'location' && typeof value === 'string') {
            next[key] = value.replace(`http://${MANAGED_INSTANCE_HOST}:${port}`, `/i/${port}`);
            continue;
        }
        next[key] = value;
    }
    return next;
}

function proxyHttpRequest(req: Request, res: Response, range: ProxyPortRange): void {
    const parsed = parseDashboardProxyUrl(req.originalUrl, range);
    if (!parsed.ok) {
        res.status(parsed.status).json({ ok: false, error: parsed.reason });
        return;
    }

    const upstream = http.request({
        hostname: MANAGED_INSTANCE_HOST,
        port: parsed.port,
        method: req.method,
        path: parsed.targetPath,
        headers: {
            ...req.headers,
            host: `${MANAGED_INSTANCE_HOST}:${parsed.port}`,
            origin: `http://${MANAGED_INSTANCE_HOST}:${parsed.port}`,
            referer: `http://${MANAGED_INSTANCE_HOST}:${parsed.port}/`,
        },
    }, (upstreamRes) => {
        res.writeHead(
            upstreamRes.statusCode || 502,
            upstreamRes.statusMessage,
            sanitizeResponseHeaders(upstreamRes.headers, parsed.port)
        );
        upstreamRes.pipe(res);
    });

    upstream.on('error', (error: Error) => {
        if (!res.headersSent) {
            res.status(502).json({ ok: false, error: error.message });
            return;
        }
        res.end();
    });

    req.pipe(upstream);
}

export function buildProxyUpgradeRequest(req: IncomingMessage, targetPath: string, targetPort: number): string {
    const lines = [`${req.method || 'GET'} ${targetPath} HTTP/${req.httpVersion}`];
    for (const [key, value] of Object.entries(req.headers)) {
        if (value == null) continue;
        const headerValue = Array.isArray(value) ? value.join(', ') : value;
        const headerName = key.toLowerCase() === 'host' ? 'Host' : key;
        lines.push(`${headerName}: ${key.toLowerCase() === 'host' ? `${MANAGED_INSTANCE_HOST}:${targetPort}` : headerValue}`);
    }
    lines.push('', '');
    return lines.join('\r\n');
}

function proxyWebSocketUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, range: ProxyPortRange): void {
    const parsed = parseDashboardProxyUrl(req.url || '', range);
    if (!parsed.ok) {
        socket.write(`HTTP/1.1 ${parsed.status} ${parsed.reason}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
        return;
    }

    const upstream = net.connect(parsed.port, MANAGED_INSTANCE_HOST, () => {
        upstream.write(buildProxyUpgradeRequest(req, parsed.targetPath, parsed.port));
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
    });

    upstream.on('error', () => {
        socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
        socket.destroy();
    });
}

export function installDashboardProxy(app: Express, server: Server, options: DashboardProxyOptions = {}): void {
    const range = dashboardProxyRange(options);

    app.use('/i/:port', (req: Request, res: Response) => {
        proxyHttpRequest(req, res, range);
    });

    server.on('upgrade', (req, socket, head) => {
        proxyWebSocketUpgrade(req, socket, head, range);
    });
}

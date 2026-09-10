import type { Request } from 'express';
import { isLoopbackAddress } from './loopback.js';

const PROXY_HEADERS = ['forwarded', 'via', 'x-real-ip', 'x-jaw-proxy-hop'] as const;
type PeerRequest = Pick<Request, 'headers' | 'ip' | 'socket' | 'protocol'>;

/** Direct local operator provenance; ordinary instance authentication still runs first. */
export function isDirectLocalApiRequest(req: PeerRequest): boolean {
    if (!isLoopbackAddress(req.socket.remoteAddress) || !isLoopbackAddress(req.ip)) return false;
    if (PROXY_HEADERS.some(name => req.headers[name] !== undefined)
        || Object.keys(req.headers).some(name => name.toLowerCase().startsWith('x-forwarded-'))) return false;
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
    if (req.protocol !== 'http' && req.protocol !== 'https') return false;
    const host = req.headers.host;
    if (typeof host !== 'string' || !host || host.length > 255) return false;
    try {
        const own = new URL(`${req.protocol}://${host}`);
        if (own.username || own.password || own.pathname !== '/' || own.search || own.hash) return false;
        if (!['localhost', '127.0.0.1', '[::1]'].includes(own.hostname.toLowerCase())) return false;
        const origin = req.headers.origin;
        if (origin !== undefined) {
            if (typeof origin !== 'string') return false;
            const source = new URL(origin);
            if (source.username || source.password || source.pathname !== '/' || source.search || source.hash
                || source.origin !== own.origin) return false;
        }
        return true;
    } catch { return false; }
}

export function isFullAccessRequest(req: PeerRequest, permissions: unknown): boolean {
    return permissions === 'auto' && isDirectLocalApiRequest(req);
}

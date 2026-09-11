/**
 * A scripted Slack in the test process: Web API over HTTP plus Socket Mode over
 * a real websocket.
 *
 * Why a websocket at all: Slack inbound is Socket Mode only — there is no events
 * HTTP route — so a crossing that starts at a real envelope has to speak it.
 * apps.connections.open hands the client its socket URL (src/slack/socket.ts),
 * so returning a loopback ws:// URL is enough and the product's own global
 * WebSocket connects here. Nothing about the client is stubbed.
 *
 * The default response for an unscripted method is ok:true, so an identity or
 * auto-join probe can never hang a boot on a method this fixture forgot.
 */
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

export type SlackCall = { method: string; body: Record<string, unknown>; at: number };

export type SlackFixture = {
    apiBase: string;
    httpPort: number;
    wsPort: number;
    calls: SlackCall[];
    callsOf(method: string): SlackCall[];
    waitForCall(method: string, predicate?: (call: SlackCall) => boolean, timeoutMs?: number): Promise<SlackCall>;
    emitUntilAcked(envelope: Record<string, unknown>, timeoutMs?: number): Promise<void>;
    acked: Set<string>;
    close(): Promise<void>;
};

const BOT_USER = 'UBOT';
const TEAM = 'T1';

export async function startSlackFixture(): Promise<SlackFixture> {
    const calls: SlackCall[] = [];
    const acked = new Set<string>();
    const sockets = new Set<WebSocket>();
    // Per-fixture, not module state: two fixtures in one file would otherwise
    // hand each other's port to files.getUploadURLExternal.
    let ownPort = 0;

    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>(ok => wss.once('listening', ok));
    const wsPort = (wss.address() as { port: number }).port;

    wss.on('connection', socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('message', raw => {
            try {
                const frame = JSON.parse(String(raw)) as { envelope_id?: string };
                if (typeof frame.envelope_id === 'string') acked.add(frame.envelope_id);
            } catch { /* the product only ever sends JSON acks */ }
        });
        // hello is the ONLY frame that moves the client to 'connected'
        // (src/slack/socket.ts). Everything received before that is dropped
        // un-acked, so a fixture that skips hello makes every emitted envelope
        // disappear. Sent on every accept, reconnects included.
        socket.send(JSON.stringify({ type: 'hello' }));
    });

    let http: Server | undefined;
    const httpPort = await new Promise<number>((ok, no) => {
        http = createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', c => chunks.push(c as Buffer));
            req.on('end', () => {
                const path = (req.url ?? '').split('?')[0] ?? '';
                const raw = Buffer.concat(chunks).toString('utf8');
                // A file upload is multipart to the upload URL, not a Web API
                // call; record it by path and answer with the plain-text OK the
                // real upload endpoint returns.
                if (path.startsWith('/upload/')) {
                    calls.push({ method: 'upload', body: { path, bytes: raw.length }, at: Date.now() });
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('OK - file_uploaded');
                    return;
                }
                const method = path.replace(/^\/api\//, '');
                let body: Record<string, unknown> = {};
                if (raw) {
                    try { body = JSON.parse(raw) as Record<string, unknown>; }
                    catch { body = Object.fromEntries(new URLSearchParams(raw)); }
                }
                calls.push({ method, body, at: Date.now() });
                res.writeHead(200, { 'Content-Type': 'application/json', 'x-oauth-scopes': SCOPES });
                res.end(JSON.stringify(reply(method, body, ownPort, wsPort)));
            });
        });
        http.on('error', no);
        http.listen(0, '127.0.0.1', () => ok((http!.address() as { port: number }).port));
    });
    ownPort = httpPort;

    async function waitForCall(method: string, predicate?: (call: SlackCall) => boolean, timeoutMs = 30_000): Promise<SlackCall> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const hit = calls.find(c => c.method === method && (predicate === undefined || predicate(c)));
            if (hit) return hit;
            await new Promise(r => setTimeout(r, 60));
        }
        const seen = [...new Set(calls.map(c => c.method))].join(', ') || 'none';
        throw new Error('no ' + method + ' call within ' + timeoutMs + 'ms; methods seen: ' + seen);
    }

    /**
     * Slack redelivers an envelope that was not acked, and the client drops
     * frames received before it is connected, so retrying the same envelope_id
     * is both the product's contract and the only way to close the race between
     * "transport running" and "socket connected". A redelivery that arrives
     * after the work is done is acked and dropped by the client's own duplicate
     * guard, so this cannot double-spawn.
     */
    async function emitUntilAcked(envelope: Record<string, unknown>, timeoutMs = 30_000): Promise<void> {
        const id = String(envelope['envelope_id']);
        const deadline = Date.now() + timeoutMs;
        let nextSend = 0;
        while (Date.now() < deadline) {
            if (acked.has(id)) return;
            // Redelivery is spaced like Slack's own, not tight. The client's
            // duplicate guard is only consulted once the frame reaches
            // handleFrame, and the work it guards is async, so hammering the
            // same envelope races the guard instead of testing it.
            if (Date.now() >= nextSend) {
                for (const socket of sockets) {
                    if (socket.readyState === 1) socket.send(JSON.stringify(envelope));
                }
                nextSend = Date.now() + 3_000;
            }
            await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('envelope ' + id + ' was never acked within ' + timeoutMs + 'ms (sockets: ' + sockets.size + ')');
    }

    return {
        apiBase: 'http://127.0.0.1:' + httpPort + '/api/',
        httpPort,
        wsPort,
        calls,
        callsOf: (method: string) => calls.filter(c => c.method === method),
        waitForCall,
        emitUntilAcked,
        acked,
        async close() {
            for (const socket of sockets) { try { socket.close(); } catch { /* closing */ } }
            await new Promise<void>(ok => wss.close(() => ok()));
            await new Promise<void>(ok => http?.close(() => ok()));
        },
    };
}

const SCOPES = 'app_mentions:read,channels:history,chat:write,files:write,reactions:write,users:read';

function reply(method: string, body: Record<string, unknown>, httpPort: number, wsPort: number): Record<string, unknown> {
    switch (method) {
        case 'auth.test':
            return { ok: true, user_id: BOT_USER, bot_id: 'B1', team_id: TEAM, team: 'fixture', url: 'https://fixture.slack.com/' };
        case 'apps.connections.open':
            return { ok: true, url: 'ws://127.0.0.1:' + wsPort + '/' };
        case 'chat.postMessage':
            return { ok: true, channel: body['channel'] ?? 'C1', ts: (Date.now() / 1000).toFixed(6), message: { text: body['text'] ?? '' } };
        case 'users.info':
            return { ok: true, user: { id: body['user'] ?? 'U1', name: 'fixture-user', real_name: 'Fixture User', profile: { display_name: 'fixture' } } };
        case 'files.getUploadURLExternal':
            // https on purpose: src/slack/slack-file.ts rejects a non-https
            // upload_url, and the preload downgrades this to the local listener.
            return { ok: true, upload_url: 'https://127.0.0.1:' + httpPort + '/upload/u1', file_id: 'F1' };
        case 'files.completeUploadExternal':
            return { ok: true, files: [{ id: 'F1', title: 'fixture' }] };
        default:
            return { ok: true };
    }
}

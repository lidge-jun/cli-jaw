import test from 'node:test';
import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import express from 'express';
import { isFullAccessRequest } from '../../src/http/full-access.ts';

type PeerRequest = Parameters<typeof isFullAccessRequest>[0];
function request(overrides: Partial<PeerRequest> = {}): PeerRequest {
    const socket = new Socket();
    Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });
    return { headers: { host: '127.0.0.1:3457' }, socket, ip: '127.0.0.1', protocol: 'http', ...overrides };
}

test('full access requires literal Auto and both actual and effective loopback peers', () => {
    for (const mode of ['safe', undefined, null, '', 'full', 'AUTO', true, ['auto']]) {
        assert.equal(isFullAccessRequest(request(), mode), false);
    }
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
        const socket = new Socket(); Object.defineProperty(socket, 'remoteAddress', { value: peer });
        assert.equal(isFullAccessRequest(request({ socket, ip: peer }), 'auto'), true);
        assert.equal(isFullAccessRequest(request({ socket, ip: '198.51.100.1' }), 'auto'), false);
    }
    const remote = new Socket(); Object.defineProperty(remote, 'remoteAddress', { value: '198.51.100.1' });
    assert.equal(isFullAccessRequest(request({ socket: remote }), 'auto'), false);
});

test('forwarding metadata cannot turn a loopback proxy hop into full access', () => {
    for (const name of ['forwarded', 'via', 'x-real-ip', 'x-jaw-proxy-hop', 'x-forwarded-for', 'x-forwarded-port', 'x-forwarded-custom']) {
        assert.equal(isFullAccessRequest(request({ headers: { host: 'localhost:3457', [name]: '127.0.0.1' } }), 'auto'), false, name);
    }
    assert.equal(isFullAccessRequest(request({ headers: { host: 'localhost:3457', 'x-jaw-full-access': '1', 'x-jaw-internal': '1' } }), 'safe'), false);
});

test('Host and browser provenance must describe an exact direct local origin', () => {
    for (const host of ['localhost:3457', '127.0.0.1:3457', '[::1]:3457']) {
        assert.equal(isFullAccessRequest(request({ headers: { host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin' } }), 'auto'), true);
    }
    assert.equal(new URL('http://[::1]:3457').hostname, '[::1]');
    for (const host of ['', 'evil.example:3457', '127.0.0.1.evil.example', 'user@localhost:3457', 'localhost:bad', 'localhost/path']) {
        assert.equal(isFullAccessRequest(request({ headers: { host } }), 'auto'), false, host);
    }
    for (const origin of ['null', 'https://localhost:3457', 'http://localhost:3458', 'http://evil.example', 'http://user@localhost:3457', 'http://localhost:3457/path']) {
        assert.equal(isFullAccessRequest(request({ headers: { host: 'localhost:3457', origin } }), 'auto'), false, origin);
    }
    for (const site of ['cross-site', 'same-site', 'unexpected']) {
        assert.equal(isFullAccessRequest(request({ headers: { host: 'localhost:3457', 'sec-fetch-site': site } }), 'auto'), false);
    }
    assert.equal(isFullAccessRequest(request({ headers: {} }), 'auto'), false);
});

test('real HTTP peers requalify each request; JSON full flags do not change policy', async t => {
    let permissions: unknown = 'auto';
    const app = express(); app.set('trust proxy', 'loopback'); app.use(express.json());
    app.post('/probe', (req, res) => res.json({ full: isFullAccessRequest(req, permissions) }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}/probe`;
    const send = async (headers: Record<string, string> = {}) => {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{"permissions":"auto","fullAccess":true}' });
        return response.json();
    };
    assert.deepEqual(await send(), { full: true });
    assert.deepEqual(await send({ 'x-forwarded-for': '198.51.100.1' }), { full: false });
    assert.deepEqual(await send({ origin: 'http://localhost:9999' }), { full: false });
    permissions = 'safe'; assert.deepEqual(await send({ 'x-jaw-full-access': '1' }), { full: false });
    permissions = 'auto'; assert.deepEqual(await send(), { full: true });
});

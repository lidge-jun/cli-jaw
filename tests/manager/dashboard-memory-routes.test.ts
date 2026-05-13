import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { createDashboardMemoryRouter } from '../../src/manager/routes/dashboard-memory.ts';
import type { ScanItemForFederation } from '../../src/manager/memory/types.ts';

function freshTmp(): string {
    return mkdtempSync(join(tmpdir(), 'jaw-routes-'));
}

async function startServer(supplier: () => Promise<ScanItemForFederation[]>): Promise<{ port: number; close: () => Promise<void> }> {
    const app = express();
    // First listen on random port to learn it, then mount router with that port as managerPort.
    return await new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            const router = createDashboardMemoryRouter({ managerPort: port, scanSupplier: supplier });
            app.use('/api/dashboard/memory', router);
            resolve({
                port,
                close: () => new Promise<void>(r => server.close(() => r())),
            });
        });
    });
}

test('routes: bad origin header → 403', async () => {
    const srv = await startServer(async () => []);
    try {
        // Send an explicit disallowed Origin header.
        const res = await fetch(`http://127.0.0.1:${srv.port}/api/dashboard/memory/instances`, {
            headers: { origin: 'http://evil.example.com' },
        });
        assert.equal(res.status, 403);
    } finally { await srv.close(); }
});

test('routes: /search empty q → 400 invalid_query', async () => {
    const srv = await startServer(async () => []);
    try {
        const res = await fetch(`http://127.0.0.1:${srv.port}/api/dashboard/memory/search?q=`);
        assert.equal(res.status, 400);
        const body = await res.json() as { code: string };
        assert.equal(body.code, 'invalid_query');
    } finally { await srv.close(); }
});

test('routes: /search query > 256 chars → 400 query_too_long', async () => {
    const srv = await startServer(async () => []);
    try {
        const q = 'a'.repeat(257);
        const res = await fetch(`http://127.0.0.1:${srv.port}/api/dashboard/memory/search?q=${encodeURIComponent(q)}`);
        assert.equal(res.status, 400);
        const body = await res.json() as { code: string };
        assert.equal(body.code, 'query_too_long');
    } finally { await srv.close(); }
});

test('routes: /read with unknown instance → 404', async () => {
    const srv = await startServer(async () => []);
    try {
        const res = await fetch(`http://127.0.0.1:${srv.port}/api/dashboard/memory/read?instance=99999&path=profile.md`);
        assert.equal(res.status, 404);
    } finally { await srv.close(); }
});

test('routes: /read rejects path traversal', async () => {
    const base = freshTmp();
    const home = join(base, '.cli-jaw-3457');
    mkdirSync(join(home, 'memory', 'structured'), { recursive: true });
    const srv = await startServer(async () => [{ port: 3457, profileId: null, homeDisplay: home }]);
    try {
        const res = await fetch(`http://127.0.0.1:${srv.port}/api/dashboard/memory/read?instance=3457&path=${encodeURIComponent('../../etc/passwd')}`);
        assert.ok([400, 404].includes(res.status), `unexpected status ${res.status}`);
    } finally { await srv.close(); }
});

test('routes: /read rejects symlinks (symlink_forbidden)', async () => {
    const base = freshTmp();
    const home = join(base, '.cli-jaw-3457');
    const memDir = join(home, 'memory', 'structured');
    mkdirSync(memDir, { recursive: true });
    const decoy = join(base, 'outside.md');
    writeFileSync(decoy, '# secret');
    symlinkSync(decoy, join(memDir, 'evil.md'));
    const srv = await startServer(async () => [{ port: 3457, profileId: null, homeDisplay: home }]);
    try {
        const res = await fetch(`http://127.0.0.1:${srv.port}/api/dashboard/memory/read?instance=3457&path=evil.md`);
        assert.equal(res.status, 400);
        const body = await res.json() as { code: string };
        assert.equal(body.code, 'symlink_forbidden');
    } finally { await srv.close(); }
});

test('routes: /read rejects non-md extension', async () => {
    const base = freshTmp();
    const home = join(base, '.cli-jaw-3457');
    const memDir = join(home, 'memory', 'structured');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'index.sqlite'), '');
    const srv = await startServer(async () => [{ port: 3457, profileId: null, homeDisplay: home }]);
    try {
        const res = await fetch(`http://127.0.0.1:${srv.port}/api/dashboard/memory/read?instance=3457&path=index.sqlite`);
        assert.equal(res.status, 400);
        const body = await res.json() as { code: string };
        assert.equal(body.code, 'unsupported_extension');
    } finally { await srv.close(); }
});

test('routes: /read reads valid .md file', async () => {
    const base = freshTmp();
    const home = join(base, '.cli-jaw-3457');
    const memDir = join(home, 'memory', 'structured');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'profile.md'), '# Profile\n\nContent.');
    const srv = await startServer(async () => [{ port: 3457, profileId: null, homeDisplay: home }]);
    try {
        const res = await fetch(`http://127.0.0.1:${srv.port}/api/dashboard/memory/read?instance=3457&path=profile.md`);
        assert.equal(res.status, 200);
        const body = await res.json() as { content: string };
        assert.match(body.content, /# Profile/);
    } finally { await srv.close(); }
});

test('routes: /instances returns shape', async () => {
    const base = freshTmp();
    const home = join(base, '.cli-jaw-3457');
    mkdirSync(home);
    const srv = await startServer(async () => [{ port: 3457, profileId: null, homeDisplay: home }]);
    try {
        const res = await fetch(`http://127.0.0.1:${srv.port}/api/dashboard/memory/instances`);
        assert.equal(res.status, 200);
        const body = await res.json() as { ok: boolean; instances: Array<{ instanceId: string }> };
        assert.equal(body.ok, true);
        assert.ok(Array.isArray(body.instances));
    } finally { await srv.close(); }
});

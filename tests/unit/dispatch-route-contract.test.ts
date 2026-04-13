import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(import.meta.dirname, '../..');
const serverSrc = fs.readFileSync(join(projectRoot, 'server.ts'), 'utf8');

test('dispatch route clears pending replay after direct API completion', () => {
    const routeStart = serverSrc.indexOf("app.post('/api/orchestrate/dispatch'");
    assert.ok(routeStart >= 0, 'dispatch route should exist');

    const routeBlock = serverSrc.slice(routeStart, routeStart + 1200);
    const finishIdx = routeBlock.indexOf('finishWorker(slot.agentId, result.text || \'\');');
    const markIdx = routeBlock.indexOf('markWorkerReplayed(slot.agentId);');
    const responseIdx = routeBlock.indexOf('res.json({ ok: true, result });');

    assert.ok(finishIdx >= 0, 'dispatch route should finish worker on success');
    assert.ok(markIdx > finishIdx, 'dispatch route should clear replay state after finishWorker');
    assert.ok(responseIdx > markIdx, 'dispatch route should respond after replay cleanup');
});

test('server boot does not import or start token keep-alive', () => {
    assert.ok(
        !serverSrc.includes("from './lib/token-keepalive.js'"),
        'server.ts should not import token keep-alive',
    );
    assert.ok(
        !serverSrc.includes('startTokenKeepAlive();'),
        'server.ts should not start token keep-alive at boot',
    );
});

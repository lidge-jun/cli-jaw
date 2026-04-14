import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';

const projectRoot = join(import.meta.dirname, '../..');
const serverSrc = fs.readFileSync(join(projectRoot, 'server.ts'), 'utf8');
const orchestrateSrc = fs.readFileSync(join(projectRoot, 'src/routes/orchestrate.ts'), 'utf8');

test('dispatch route clears pending replay after direct API completion', () => {
    const routeStart = orchestrateSrc.indexOf("app.post('/api/orchestrate/dispatch'");
    assert.ok(routeStart >= 0, 'dispatch route should exist');

    const routeBlock = orchestrateSrc.slice(routeStart, routeStart + 2000);
    const finishIdx = routeBlock.indexOf('finishWorker(slot.agentId, result.text || \'\');');
    const markIdx = routeBlock.indexOf('markWorkerReplayed(slot.agentId);');
    const responseIdx = routeBlock.indexOf('res.json({ ok: true, result });');

    assert.ok(finishIdx >= 0, 'dispatch route should finish worker on success');
    assert.ok(markIdx > finishIdx, 'dispatch route should clear replay state after finishWorker');
    assert.ok(responseIdx > markIdx, 'dispatch route should respond after replay cleanup');
});

test('dispatch route maps PABCD phase from state-machine', () => {
    const routeStart = orchestrateSrc.indexOf("app.post('/api/orchestrate/dispatch'");
    assert.ok(routeStart >= 0, 'dispatch route should exist');
    const routeBlock = orchestrateSrc.slice(routeStart, routeStart + 1500);

    // Phase map must exist in dispatch route
    assert.ok(
        routeBlock.includes('PABCD_PHASE_MAP'),
        'dispatch route should contain PABCD_PHASE_MAP for phase auto-mapping',
    );
    // Must call getState to read current orchestration phase
    assert.ok(
        routeBlock.includes('getState('),
        'dispatch route should call getState() to read current PABCD phase',
    );
    // Must call resolveOrcScope for proper scope resolution
    assert.ok(
        routeBlock.includes('resolveOrcScope('),
        'dispatch route should call resolveOrcScope() for scope resolution',
    );
    // resolvedPhase must be used in ap object (not hardcoded 3)
    assert.ok(
        routeBlock.includes('currentPhase: resolvedPhase'),
        'dispatch route should use resolvedPhase (not hardcoded phase 3)',
    );
});

test('dispatch route accepts optional phase override in request body', () => {
    const routeStart = orchestrateSrc.indexOf("app.post('/api/orchestrate/dispatch'");
    const routeBlock = orchestrateSrc.slice(routeStart, routeStart + 1500);

    // Must destructure phase from req.body
    assert.ok(
        routeBlock.includes('phase') && routeBlock.includes('req.body'),
        'dispatch route should accept phase from request body',
    );
    // resolvedPhase should fallback: explicit phase → PABCD map → default 3
    assert.ok(
        routeBlock.includes('phase ??'),
        'dispatch route should use nullish coalescing for phase fallback',
    );
});

test('pipeline.ts no longer contains parseSubtasks worker dispatch', () => {
    const pipelineSrc = fs.readFileSync(join(projectRoot, 'src/orchestrator/pipeline.ts'), 'utf8');

    // Worker JSON dispatch block must be removed
    assert.ok(
        !pipelineSrc.includes('worker JSON detected'),
        'pipeline.ts should not contain worker JSON dispatch block after patch3',
    );
    assert.ok(
        !pipelineSrc.includes('parseSubtasks(result.text)'),
        'pipeline.ts should not call parseSubtasks on boss result',
    );
    // stripSubtaskJSON should still exist for plan saving
    assert.ok(
        pipelineSrc.includes('stripSubtaskJSON'),
        'pipeline.ts should still use stripSubtaskJSON for plan saving',
    );
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

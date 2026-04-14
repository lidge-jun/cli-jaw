import type { Express } from 'express';
import type { AuthMiddleware } from './types.js';
import { ok, fail } from '../http/response.js';
import { isAgentBusy, messageQueue } from '../agent/spawn.js';
import { orchestrateContinue, orchestrateReset } from '../orchestrator/pipeline.js';
import { getState, getCtx, setState, resetState, canTransition } from '../orchestrator/state-machine.js';
import type { OrcStateName } from '../orchestrator/state-machine.js';
import { resolveOrcScope } from '../orchestrator/scope.js';
import { getActiveWorkers, claimWorker, finishWorker, failWorker, markWorkerReplayed } from '../orchestrator/worker-registry.js';
import { findEmployee, runSingleAgent } from '../orchestrator/distribute.js';
import { getEmployees } from '../core/db.js';
import { settings } from '../core/config.js';

function getRuntimeSnapshot() {
    return {
        uptimeSec: Math.floor(process.uptime()),
        activeAgent: isAgentBusy(),
        queuePending: messageQueue.length,
    };
}

export function registerOrchestrateRoutes(app: Express, requireAuth: AuthMiddleware): void {
    app.post('/api/orchestrate/continue', requireAuth, (req, res) => {
        if (isAgentBusy()) {
            return res.status(409).json({ error: 'agent already running' });
        }
        orchestrateContinue({ origin: 'web' });
        res.json({ ok: true });
    });

    app.post('/api/orchestrate/reset', requireAuth, async (req, res) => {
        try {
            await orchestrateReset({ origin: 'web' });
            res.json({ ok: true });
        } catch (err) {
            console.error('[orchestrate:reset] error', err);
            res.status(500).json({ ok: false, error: String(err) });
        }
    });

    app.get('/api/orchestrate/state', (_req, res) => {
        const scope = resolveOrcScope({ origin: 'web', workingDir: settings.workingDir || null });
        res.json({ scope, state: getState(scope), ctx: getCtx(scope) });
    });

    app.get('/api/orchestrate/workers', (_req, res) => {
        res.json(getActiveWorkers());
    });

    app.get('/api/orchestrate/snapshot', (_req, res) => {
        const runtime = getRuntimeSnapshot();
        const scope = resolveOrcScope({ origin: 'web', workingDir: settings.workingDir || null });
        res.json({
            orc: { scope, state: getState(scope), ctx: getCtx(scope) },
            runtime: {
                ...runtime,
                busy: runtime.activeAgent || getActiveWorkers().some(w => w.state === 'running'),
            },
            workers: getActiveWorkers(),
        });
    });

    // Pipe-mode employee dispatch
    app.post('/api/orchestrate/dispatch', requireAuth, async (req, res) => {
        if (String(req.headers['x-jaw-dispatch-source'] || '').toLowerCase() === 'employee') {
            return fail(res, 409, 'Employee self-dispatch is blocked in employee sessions');
        }
        const { agent: agentName, task, phase } = req.body || {};
        if (!agentName || !task) return fail(res, 400, 'Missing agent or task');

        const PABCD_PHASE_MAP: Record<string, number> = { A: 2, B: 3, C: 4 };
        const dispatchScope = resolveOrcScope({ origin: 'web', workingDir: settings.workingDir || null });
        const currentOrcState = getState(dispatchScope);
        const resolvedPhase = phase ?? PABCD_PHASE_MAP[currentOrcState] ?? 3;

        const emps = getEmployees.all() as Record<string, any>[];
        const emp = findEmployee(emps, { agent: agentName });
        if (!emp) return fail(res, 404, `Employee not found: ${agentName}`);

        const slot = claimWorker(emp, task);
        try {
            const ap = {
                agent: emp.name, role: emp.role || 'general developer',
                task, parallel: false,
                currentPhase: resolvedPhase, currentPhaseIdx: 0,
                phaseProfile: [resolvedPhase],
            };
            const result = await runSingleAgent(ap, emp, {}, 1, { origin: 'api' }, []);
            finishWorker(slot.agentId, result.text || '');
            markWorkerReplayed(slot.agentId);
            res.json({ ok: true, result });
        } catch (err: any) {
            failWorker(slot.agentId, err.message);
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    app.put('/api/orchestrate/state', requireAuth, (req, res) => {
        const target = String(req.body?.state || '').toUpperCase();
        const valid: OrcStateName[] = ['P', 'A', 'B', 'C', 'D'];
        if (!valid.includes(target as OrcStateName)) {
            return fail(res, 400, `Invalid state: ${target}. Must be one of: ${valid.join(', ')}`);
        }
        const scope = resolveOrcScope({ origin: 'web', workingDir: settings.workingDir || null });
        const current = getState(scope);
        const t = target as OrcStateName;
        if (!canTransition(current, t)) {
            return fail(res, 409, `Cannot transition: ${current} → ${t}`);
        }
        if (t === 'D') {
            setState(t, undefined, scope, 'Done');
            resetState(scope);
        } else {
            setState(
                t,
                t === 'P' ? { originalPrompt: '', workingDir: settings.workingDir || null, plan: null, workerResults: [], origin: 'api' } : undefined,
                scope,
                t === 'P' ? 'P' : t,
            );
        }
        res.json({ ok: true, state: getState(scope) });
    });
}

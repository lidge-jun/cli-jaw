import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';

const { killActiveAgent, killAgentById, activeProcesses } = await import('../../src/agent/spawn.ts');
const registry = await import('../../src/orchestrator/worker-registry.ts');
const { getWorkerRunRecord } = await import('../../src/orchestrator/worker-run-store.ts');

/** A plain long-lived child standing in for an employee CLI. */
async function spawnIdleChild(): Promise<ChildProcess> {
    const child = spawn(process.execPath, ['-e',
        "setInterval(() => {}, 1000); process.stdout.write('READY');",
    ]);
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('worker fixture never reported ready')), 10_000);
        child.stdout!.on('data', (chunk: Buffer) => {
            if (chunk.toString().includes('READY')) { clearTimeout(timer); resolve(); }
        });
        child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    return child;
}

function enlistWorker(agentId: string, scopeId: string, child: ChildProcess) {
    const slot = registry.claimWorker({ id: agentId, name: agentId }, 'stop fixture', { scopeId });
    activeProcesses.set(agentId, child);
    return slot;
}

function retire(agentId: string, child: ChildProcess): void {
    activeProcesses.delete(agentId);
    registry.clearWorkersForScope('sw-user');
    registry.clearWorkersForScope('sw-steer');
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

// ─── SW-001 ───
//
// A user stop cleared the worker registry but never signalled the child. Claude
// employees died earlier inside cancelClaudeScope, so the gap was invisible there
// and every other runtime's employee kept running against a scope the boss had
// already abandoned. orchestrateReset and the worker timeout both already kill
// before clearing; only the stop path did not (#701).

test('SW-001: a user stop actually stops a non-Claude employee, not just its registry slot',
    { timeout: 20_000 }, async () => {
    const child = await spawnIdleChild();
    const agentId = 'sw-001-worker';
    const slot = enlistWorker(agentId, 'sw-user', child);
    try {
        assert.equal(registry.getActiveWorkers('sw-user').length, 1, 'fixture must be registered as running');

        killActiveAgent('sw-user', 'user');

        await once(child, 'exit');
        assert.notEqual(child.exitCode === null && child.signalCode === null, true,
            'the employee child must be stopped, not merely forgotten');
        assert.equal(registry.getActiveWorkers('sw-user').length, 0, 'the slot must still be cleared');
        // Deleting a slot leaves its run row 'running' forever, because finishWorker
        // and failWorker both no-op once the slot is gone. Reset already cancels.
        assert.equal(getWorkerRunRecord(slot.runId)?.status, 'cancelled',
            'the worker run must be recorded as cancelled, not left running');
    } finally {
        retire(agentId, child);
    }
});

// ─── SW-002 ───
//
// Only the Pi branch of killAgentById stamped a kill reason, so a deliberately
// stopped employee on any other runtime reached handleAgentExit with
// wasKilled=false. That is what the employee retry branch keys on, so the stop
// could respawn the very turn the caller had just cancelled.

test('SW-002: killAgentById records the stop for a non-Pi worker so it is not read as a crash',
    { timeout: 20_000 }, async () => {
    const child = await spawnIdleChild();
    const agentId = 'sw-002-worker';
    activeProcesses.set(agentId, child);
    try {
        assert.ok(child.pid, 'fixture must have a pid');
        assert.equal(killAgentById(agentId), true, 'the worker kill port must accept a live child');
        await once(child, 'exit');
    } finally {
        activeProcesses.delete(agentId);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }

    // killReasons is module-private with no read accessor, so the recording itself
    // is checked structurally — scoped to this one function body rather than by
    // counting occurrences file-wide. What it pins is the ordering that matters: the
    // Pi early return sits above, and the generic terminate below must be preceded by
    // a live-pid stamp. The CONSEQUENCE (handleAgentExit seeing wasKilled=true and
    // therefore skipping the employee retry) is not executed here.
    const source = await readFile(new URL('../../src/agent/spawn.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export function killAgentById');
    assert.ok(start > 0, 'killAgentById must exist');
    const body = source.slice(start, source.indexOf('\nexport ', start + 1));
    const stamp = body.indexOf('killReasons.set(');
    const terminate = body.indexOf('ownProcess(proc).terminate(');
    assert.ok(stamp > 0, 'killAgentById must record a kill reason for non-Pi workers');
    assert.ok(terminate > stamp, 'the kill reason must be recorded before the child is terminated');
    assert.match(body.slice(Math.max(0, stamp - 120), stamp), /hasChildExited\(proc\)/,
        'only a live pid may be stamped, or a recycled pid inherits a foreign kill reason');
});

// ─── SW-003 ───
//
// A steer replaces the boss turn and deliberately keeps its workers, so the new
// kill must stay bound to the user/api stop that clears the registry.

test('SW-003: a steer leaves employees running', { timeout: 20_000 }, async () => {
    const child = await spawnIdleChild();
    const agentId = 'sw-003-worker';
    enlistWorker(agentId, 'sw-steer', child);
    try {
        killActiveAgent('sw-steer', 'steer');
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.equal(child.exitCode, null, 'a steer must not reap an employee');
        assert.equal(child.signalCode, null, 'a steer must not signal an employee');
        assert.equal(registry.getActiveWorkers('sw-steer').length, 1, 'a steer must keep the worker slot');
    } finally {
        retire(agentId, child);
    }
});

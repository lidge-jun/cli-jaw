import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Static guards for the stop / steer / pending-queue regression fixes
// (devlog/_plan/steer/05_stop_steer_bug_report.md).
//
// These do not exercise runtime behavior — they pin the source-level
// invariants so the fixes don't silently regress.

const spawnSrc = fs.readFileSync(join(__dirname, '../../src/agent/spawn.ts'), 'utf8');
const orchestrateRouteSrc = fs.readFileSync(join(__dirname, '../../src/routes/orchestrate.ts'), 'utf8');

// ─── Fix A: stop should clear the queue ──────────────────────────────

test('Fix A: purgeQueueOnStop helper exists and clears queue + persisted DB rows', () => {
    const fnIdx = spawnSrc.indexOf('function purgeQueueOnStop');
    assert.ok(fnIdx > 0, 'purgeQueueOnStop helper must exist in spawn.ts');
    const body = spawnSrc.slice(fnIdx, fnIdx + 600);
    assert.ok(body.includes('messageQueue.splice(0)'), 'must drain messageQueue in place');
    assert.ok(body.includes('deleteQueuedMessage.run'), 'must remove persisted DB rows');
    assert.ok(body.includes("broadcast('queue_update'"), 'must broadcast pending=0 to clients');
});

test("Fix A: killActiveAgent purges queue when reason='api' or 'user'", () => {
    const fnIdx = spawnSrc.indexOf('export function killActiveAgent');
    const body = spawnSrc.slice(fnIdx, fnIdx + 1200);
    assert.ok(
        /reason === 'api'\s*\|\|\s*reason === 'user'.*purgeQueueOnStop/s.test(body),
        "killActiveAgent must call purgeQueueOnStop when reason is 'api' or 'user'",
    );
});

test("Fix A: killAllAgents purges queue when reason='api' or 'user'", () => {
    const fnIdx = spawnSrc.indexOf('export function killAllAgents');
    const body = spawnSrc.slice(fnIdx, fnIdx + 1500);
    assert.ok(
        /reason === 'api'\s*\|\|\s*reason === 'user'.*purgeQueueOnStop/s.test(body),
        "killAllAgents must call purgeQueueOnStop when reason is 'api' or 'user'",
    );
});

// ─── Fix B: steer route must not double-insert / double-broadcast ─────

function getSteerHandlerBlock(): string {
    const routeIdx = orchestrateRouteSrc.indexOf("'/api/orchestrate/queue/:id/steer'");
    assert.ok(routeIdx > 0, 'steer route must exist');
    // Terminate at the next route registration so we only inspect this handler.
    const tail = orchestrateRouteSrc.slice(routeIdx);
    const nextRouteRel = tail.slice(50).search(/app\.(post|get|delete|put)\(/);
    const end = nextRouteRel > 0 ? nextRouteRel + 50 : tail.length;
    return tail.slice(0, end);
}

test('Fix B: steer route does not call submitMessage (avoids double insert+broadcast)', () => {
    const block = getSteerHandlerBlock();
    assert.ok(!block.includes('submitMessage('), 'steer route must NOT call submitMessage — that path re-inserts and re-broadcasts the user message');
});

test('Fix B: steer route uses peek → kill → wait → remove ordering', () => {
    const block = getSteerHandlerBlock();
    const peekIdx = block.indexOf('messageQueue.find');
    const killIdx = block.indexOf("killActiveAgent('steer')");
    const waitIdx = block.indexOf('waitForProcessEnd');
    const removeIdx = block.indexOf('removeQueuedMessage');
    assert.ok(peekIdx > 0 && killIdx > peekIdx, 'must peek before killing — otherwise a kill failure leaves the queue mutated');
    assert.ok(waitIdx > killIdx, 'must wait for process end after kill');
    assert.ok(removeIdx > waitIdx, 'must remove from queue only after the kill+wait succeeds');
});

test('Fix B: steer route inserts the user message exactly once and orchestrates with _skipInsert', () => {
    const block = getSteerHandlerBlock();
    assert.ok(block.includes('insertMessage.run'), 'must insert into messages table once (mirrors processQueue)');
    assert.ok(block.includes('_skipInsert: true'), 'must pass _skipInsert: true to orchestrate to avoid a second insert downstream');
    // gateway.ts already broadcast new_message at enqueue time, so steer route must NOT re-broadcast.
    // Strip line comments before checking so doc-strings explaining the rule don't trip the regex.
    const codeOnly = block.replace(/\/\/[^\n]*/g, '');
    assert.ok(!/broadcast\(\s*['"]new_message['"]/.test(codeOnly), 'must NOT broadcast new_message — gateway already did at enqueue time');
});

// ─── Fix C1: stop should make isAgentBusy() return false synchronously ──

test('Fix C1: killActiveAgent nullifies activeProcess synchronously when stopped by user', () => {
    const fnIdx = spawnSrc.indexOf('export function killActiveAgent');
    const body = spawnSrc.slice(fnIdx, fnIdx + 1500);
    // Look for the synchronous nullify guarded by reason
    assert.ok(
        /reason === 'api'\s*\|\|\s*reason === 'user'\s*\)\s*\{\s*activeProcess\s*=\s*null/s.test(body),
        "killActiveAgent must set activeProcess = null synchronously when reason is 'api' or 'user' so isAgentBusy() flips immediately",
    );
});

test('Fix C1: killAllAgents clears activeProcess + activeProcesses synchronously when stopped by user', () => {
    const fnIdx = spawnSrc.indexOf('export function killAllAgents');
    const body = spawnSrc.slice(fnIdx, fnIdx + 2000);
    assert.ok(
        /reason === 'api'\s*\|\|\s*reason === 'user'\s*\)\s*\{\s*activeProcess\s*=\s*null;\s*activeProcesses\.clear\(\)/s.test(body),
        "killAllAgents must synchronously clear activeProcess and activeProcesses for 'api'/'user' stops",
    );
});

// ─── Cross-cutting: steer reason must not trigger Fix A purge ─────────

test('Fix A is scoped: steer reason does NOT purge the queue', () => {
    // Confirm the regex used in killActiveAgent guards specifically against
    // 'api' and 'user', leaving 'steer' (and any other reason) untouched.
    const fnIdx = spawnSrc.indexOf('export function killActiveAgent');
    const body = spawnSrc.slice(fnIdx, fnIdx + 1200);
    // Make sure 'steer' is not in the purge condition
    const purgeLine = body.match(/if\s*\(reason === '[^']+'\s*\|\|\s*reason === '[^']+'\)\s*purgeQueueOnStop/);
    assert.ok(purgeLine, 'purge condition must be a strict OR of two reasons');
    assert.ok(!purgeLine[0].includes("'steer'"), "'steer' reason must not trigger queue purge — steer needs the queued item to survive temporarily");
});

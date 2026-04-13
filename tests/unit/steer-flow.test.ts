import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── SF-001: steerAgent flow — kill existing + wait + start new ───

test('SF-001: steerAgent flow: kill → wait → insert → orchestrate', () => {
    const src = fs.readFileSync(join(__dirname, '../../src/agent/spawn.ts'), 'utf8');

    // Extract steerAgent function body
    const fnStart = src.indexOf('export async function steerAgent');
    assert.ok(fnStart > 0, 'steerAgent should be exported');

    // Find matching closing brace (roughly — next export function)
    const fnEnd = src.indexOf('\nexport ', fnStart + 10);
    const steerBody = src.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 500);

    // Step 1: kill with 'steer' reason
    const killIdx = steerBody.indexOf("killActiveAgent('steer')");
    assert.ok(killIdx > 0, 'should call killActiveAgent("steer")');

    // Step 2: wait for process end
    const waitIdx = steerBody.indexOf('waitForProcessEnd');
    assert.ok(waitIdx > killIdx, 'should wait for process end AFTER kill');

    // Step 3: insert message
    const insertIdx = steerBody.indexOf('insertMessage.run');
    assert.ok(insertIdx > waitIdx, 'should insert message AFTER wait');

    // Step 4: broadcast
    const broadcastIdx = steerBody.indexOf("broadcast('new_message'");
    assert.ok(broadcastIdx > insertIdx, 'should broadcast AFTER insert');

    // Step 5: orchestrate (one of three kinds)
    const orchestrateIdx = Math.min(
        steerBody.indexOf('orchestrateReset') > 0 ? steerBody.indexOf('orchestrateReset') : Infinity,
        steerBody.indexOf('orchestrateContinue') > 0 ? steerBody.indexOf('orchestrateContinue') : Infinity,
        steerBody.indexOf('orchestrate(') > 0 ? steerBody.indexOf('orchestrate(') : Infinity,
    );
    assert.ok(orchestrateIdx > broadcastIdx, 'should orchestrate AFTER broadcast');
});

// ─── SF-002: steerAgent saves interrupted output via exit handler ───

test('SF-002: exit handler saves interrupted content to DB via insertMessageWithTrace', () => {
    // After Phase 2 decomposition, interrupted tagging + insertMessageWithTrace
    // moved to lifecycle-handler.ts (handleAgentExit). Verify it there.
    const lifecycleSrc = fs.readFileSync(join(__dirname, '../../src/agent/lifecycle-handler.ts'), 'utf8');

    const interruptedIdx = lifecycleSrc.indexOf('⏹️ [interrupted]');
    const insertTraceIdx = lifecycleSrc.indexOf('insertMessageWithTrace.run');
    assert.ok(interruptedIdx > 0, 'lifecycle-handler should have interrupted tagging');
    assert.ok(insertTraceIdx > interruptedIdx, 'insertMessageWithTrace should come after interrupted tagging');

    // Also verify spawn.ts exit handlers delegate to handleAgentExit
    const spawnSrc = fs.readFileSync(join(__dirname, '../../src/agent/spawn.ts'), 'utf8');

    const acpExitIdx = spawnSrc.indexOf("acp.on('exit'");
    assert.ok(acpExitIdx > 0);
    const acpBlock = spawnSrc.slice(acpExitIdx, acpExitIdx + 7000);
    assert.ok(acpBlock.includes('handleAgentExit'), 'ACP exit should delegate to handleAgentExit');

    const cliCloseIdx = spawnSrc.indexOf("child.on('close'");
    assert.ok(cliCloseIdx > 0);
    const cliBlock = spawnSrc.slice(cliCloseIdx, cliCloseIdx + 7000);
    assert.ok(cliBlock.includes('handleAgentExit'), 'CLI close should delegate to handleAgentExit');
});

// ─── SF-003: buildHistoryBlock includes trace (which has interrupted tag) ───

test('SF-003: buildHistoryBlock uses trace for assistant messages, preserving interrupted tag', () => {
    const src = fs.readFileSync(join(__dirname, '../../src/agent/spawn.ts'), 'utf8');

    // Find buildHistoryBlock function
    const fnIdx = src.indexOf('function buildHistoryBlock');
    assert.ok(fnIdx > 0, 'buildHistoryBlock function should exist');

    const fnBlock = src.slice(fnIdx, fnIdx + 1500);

    // It should prefer row.trace over row.content for assistant messages
    assert.ok(
        fnBlock.includes("role === 'assistant' && row.trace"),
        'should check if assistant message has trace',
    );

    // When trace exists, it uses trace text (which will contain ⏹️ [interrupted])
    assert.ok(
        fnBlock.includes('row.trace'),
        'should use row.trace for assistant messages',
    );

    // content fallback for non-assistant or no-trace
    assert.ok(
        fnBlock.includes(`[${`role || 'user'`}]`) || fnBlock.includes('role ||'),
        'should have fallback for content display',
    );
});

// ─── SF-EDGE: processQueue is called after mainManaged exit ───

test('SF-EDGE: processQueue is triggered after mainManaged exit in both paths', () => {
    const src = fs.readFileSync(join(__dirname, '../../src/agent/spawn.ts'), 'utf8');

    // ACP path — processQueue passed to handleAgentExit (or called directly)
    const acpExitIdx = src.indexOf("acp.on('exit'");
    const acpBlock = src.slice(acpExitIdx, acpExitIdx + 8000);
    assert.ok(
        acpBlock.includes('processQueue'),
        'ACP exit should reference processQueue (direct call or handleAgentExit param)',
    );

    // CLI path — processQueue passed to handleAgentExit (or called directly)
    const cliCloseIdx = src.indexOf("child.on('close'");
    const cliBlock = src.slice(cliCloseIdx, cliCloseIdx + 8000);
    assert.ok(
        cliBlock.includes('processQueue'),
        'CLI close should reference processQueue (direct call or handleAgentExit param)',
    );
});

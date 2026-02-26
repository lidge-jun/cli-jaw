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
    const src = fs.readFileSync(join(__dirname, '../../src/agent/spawn.ts'), 'utf8');

    // Verify that after interrupted tagging, insertMessageWithTrace is called
    // ACP path
    const acpExitIdx = src.indexOf("acp.on('exit'");
    assert.ok(acpExitIdx > 0);
    const acpBlock = src.slice(acpExitIdx, acpExitIdx + 3500);

    const interruptedIdx = acpBlock.indexOf('⏹️ [interrupted]');
    const insertTraceIdx = acpBlock.indexOf('insertMessageWithTrace.run');
    assert.ok(interruptedIdx > 0, 'ACP exit should have interrupted tagging');
    assert.ok(insertTraceIdx > interruptedIdx, 'insertMessageWithTrace should come after interrupted tagging');

    // CLI path
    const cliCloseIdx = src.indexOf("child.on('close'");
    assert.ok(cliCloseIdx > 0);
    const cliBlock = src.slice(cliCloseIdx, cliCloseIdx + 3500);

    const cliInterruptedIdx = cliBlock.indexOf('⏹️ [interrupted]');
    const cliInsertIdx = cliBlock.indexOf('insertMessageWithTrace.run');
    assert.ok(cliInterruptedIdx > 0, 'CLI close should have interrupted tagging');
    assert.ok(cliInsertIdx > cliInterruptedIdx, 'CLI insertMessageWithTrace should come after interrupted tagging');
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

    // ACP path — processQueue after exit
    const acpExitIdx = src.indexOf("acp.on('exit'");
    const acpBlock = src.slice(acpExitIdx, acpExitIdx + 5000);
    assert.ok(
        acpBlock.includes('processQueue()'),
        'ACP exit should call processQueue',
    );

    // CLI path — processQueue after close
    const cliCloseIdx = src.indexOf("child.on('close'");
    const cliBlock = src.slice(cliCloseIdx, cliCloseIdx + 5500);
    assert.ok(
        cliBlock.includes('processQueue()'),
        'CLI close should call processQueue',
    );
});

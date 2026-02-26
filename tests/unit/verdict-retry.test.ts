// DIFF-D 검증: verdict parse 실패 → retry + 명시적 FAIL 경로
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pipelineSrc = fs.readFileSync(join(__dirname, '../../src/orchestrator/pipeline.ts'), 'utf8');
const spawnSrc = fs.readFileSync(join(__dirname, '../../src/agent/spawn.ts'), 'utf8');

// ─── VR: Verdict Retry 구조 검증 ─────────────────────

test('VR-001: verdict destructuring uses let (not const) — triage path', () => {
    // triage path (L271 부근)
    const triageMatch = pipelineSrc.match(/let\s*\{\s*verdicts,\s*rawText\s*\}\s*=\s*await\s+phaseReview/g);
    assert.ok(triageMatch, 'should use let for verdicts/rawText destructuring');
    assert.ok(triageMatch.length >= 2, 'both triage and main paths should use let');
});

test('VR-002: retry calls phaseReview on verdict parse fail', () => {
    const retryCount = (pipelineSrc.match(/retrying once/g) || []).length;
    assert.equal(retryCount, 2, 'retry message should appear in both triage and main paths');
});

test('VR-003: retry success merges verdicts back', () => {
    const mergeCount = (pipelineSrc.match(/verdicts\s*=\s*retryResult\.verdicts/g) || []).length;
    assert.equal(mergeCount, 2, 'verdicts should be merged from retryResult in both paths');
});

test('VR-004: retry success merges rawText back', () => {
    const mergeCount = (pipelineSrc.match(/rawText\s*=\s*retryResult\.rawText/g) || []).length;
    assert.equal(mergeCount, 2, 'rawText should be merged from retryResult in both paths');
});

test('VR-005: retry failure marks all active as FAIL', () => {
    const failCount = (pipelineSrc.match(/auto-fail \(verdict parse failed x2\)/g) || []).length;
    assert.equal(failCount, 2, 'auto-fail feedback should appear in both paths');
});

test('VR-006: no auto-pass on verdict failure', () => {
    assert.ok(
        !pipelineSrc.includes('auto-pass'),
        'auto-pass should not exist — quality gate must be preserved',
    );
});

// ─── RV: Review Truncation 검증 ──────────────────────

test('RV-001: phaseReview report truncation uses 1200 chars', () => {
    assert.ok(pipelineSrc.includes('.slice(0, 1200)'), 'report truncation should be 1200 chars');
    assert.ok(!pipelineSrc.includes('.slice(0, 400)'), 'old 400 char truncation should be removed');
});

// ─── QP: Queue Policy 검증 ───────────────────────────

test('QP-001: queue policy is documented as "fair"', () => {
    assert.ok(
        spawnSrc.includes('Queue policy: "fair"'),
        'spawn.ts should document fair queue policy',
    );
});

test('QP-002: batch tail goes after remaining (fair ordering)', () => {
    const queueBlock = spawnSrc.slice(
        spawnSrc.indexOf('if (batch.length > 1)'),
        spawnSrc.indexOf('const combined = batch[0]'),
    );
    assert.ok(
        queueBlock.includes('...remaining, ...batch.slice(1)'),
        'remaining should come before batch tail in push',
    );
});

// ─── RC: orchestrateContinue 제약 검증 ───────────────

test('RC-001: orchestrateContinue prompt has constraint section', () => {
    const continueBlock = pipelineSrc.slice(
        pipelineSrc.indexOf('async function orchestrateContinue') || pipelineSrc.indexOf('export async function orchestrateContinue'),
        pipelineSrc.indexOf('return orchestrate(resumePrompt'),
    );
    assert.ok(
        continueBlock.includes('제약 조건'),
        'resume prompt should include constraint section',
    );
    assert.ok(
        continueBlock.includes('agent 이름, role, 현재 phase를 그대로 유지'),
        'constraints should mention preserving agent/role/phase',
    );
});

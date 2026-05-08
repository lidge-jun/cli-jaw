// Phase 9.4: orchestrator triage 단위 테스트
// 이미 export된 함수를 직접 검증 (추가 작업 없이 즉시 실행 가능)
import test from 'node:test';
import assert from 'node:assert/strict';
import { isContinueIntent } from '../../src/orchestrator/pipeline.ts';

// ─── isContinueIntent ────────────────────────────────

test('ORT-001: explicit "/continue" matches', () => {
    assert.equal(isContinueIntent('/continue'), true);
});

test('ORT-002: natural-language continue stays a normal prompt', () => {
    assert.equal(isContinueIntent('continue'), false);
    assert.equal(isContinueIntent('Continue'), false);
    assert.equal(isContinueIntent('again'), false);
});

test('ORT-003: Korean continue phrases stay normal prompts', () => {
    assert.equal(isContinueIntent('이어서 해줘'), false);
    assert.equal(isContinueIntent('이어서'), false);
    assert.equal(isContinueIntent('계속 해줘'), false);
    assert.equal(isContinueIntent('계속'), false);
    assert.equal(isContinueIntent('다시'), false);
    assert.equal(isContinueIntent('다시 해줘'), false);
});

test('ORT-004: non-continue intent returns false', () => {
    assert.equal(isContinueIntent('계획 짜줘'), false);
    assert.equal(isContinueIntent('server.js 수정해줘'), false);
    assert.equal(isContinueIntent('안녕'), false);
});

test('ORT-005: empty/null returns false', () => {
    assert.equal(isContinueIntent(''), false);
    assert.equal(isContinueIntent(null), false);
    assert.equal(isContinueIntent(undefined), false);
});

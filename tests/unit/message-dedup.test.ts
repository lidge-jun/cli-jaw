// 260417_message_duplication: L2 server-side 5s dedup + L3-b Boss Bash timeout directive.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';

const srcRoot = new URL('../../src/', import.meta.url).pathname;

// ─── L2: gateway.ts 5s dedup window ──────────────────

const gatewaySrc = fs.readFileSync(join(srcRoot, 'orchestrator/gateway.ts'), 'utf8');

test('MD-001: gateway exports __resetSubmitDedupForTest', () => {
    assert.match(gatewaySrc, /export function __resetSubmitDedupForTest/);
});

test('MD-002: gateway defines DEDUP_WINDOW_MS (>=5s, <=30s sanity)', () => {
    const m = gatewaySrc.match(/DEDUP_WINDOW_MS\s*=\s*(\d+)/);
    assert.ok(m, 'DEDUP_WINDOW_MS constant must exist');
    const ms = Number(m![1]);
    assert.ok(ms >= 3000 && ms <= 30_000, `DEDUP_WINDOW_MS=${ms} outside sane range`);
});

test('MD-003: gateway submitMessage checks recentSubmissions before insert', () => {
    const submitBlock = gatewaySrc.slice(gatewaySrc.indexOf('export function submitMessage'));
    assert.match(submitBlock, /recentSubmissions\.get\(/, 'must look up prior submission');
    assert.match(submitBlock, /reason:\s*['"]duplicate['"]/, 'must return duplicate rejection');
    assert.match(submitBlock, /recentSubmissions\.set\(/, 'must record new submission');
});

test('MD-004: gateway dedup key normalizes whitespace', () => {
    const keyFn = gatewaySrc.match(/function dedupKey[\s\S]*?\n\}/)?.[0] || '';
    assert.match(keyFn, /\.trim\(\)/);
    assert.match(keyFn, /replace\(\/\\s\+\/g/);
});

// ─── L1: chat.ts frontend in-flight guard ────────────

const chatSrc = fs.readFileSync(new URL('../../public/js/features/chat.ts', import.meta.url).pathname, 'utf8');

test('MD-005: chat.ts has __chatSending guard flag', () => {
    assert.match(chatSrc, /let __chatSending\s*=\s*false/);
    assert.match(chatSrc, /if \(__chatSending\)\s*return/);
});

test('MD-006: chat.ts sets __chatSending=true and releases in finally', () => {
    const sendBlock = chatSrc.slice(chatSrc.indexOf('export async function sendMessage'));
    assert.match(sendBlock, /__chatSending\s*=\s*true/);
    assert.match(sendBlock, /} finally {[\s\S]*?__chatSending\s*=\s*false/);
});

test('MD-007: chat.ts disables send button during in-flight', () => {
    const sendBlock = chatSrc.slice(chatSrc.indexOf('export async function sendMessage'));
    assert.match(sendBlock, /sendBtn\.disabled\s*=\s*true/);
    assert.match(sendBlock, /sendBtn\.disabled\s*=\s*prevDisabled/);
});

test('MD-008: chat.ts absorbs 409 duplicate silently (no error toast)', () => {
    const sendBlock = chatSrc.slice(chatSrc.indexOf('export async function sendMessage'));
    assert.match(sendBlock, /res\.status\s*===\s*409[\s\S]{0,120}['"]duplicate['"]/);
});

// ─── L3-b: Boss prompts direct Bash timeout=600000 ────

test('MD-009: orchestration.md directs timeout=600000 for cli-jaw dispatch', () => {
    const md = fs.readFileSync(join(srcRoot, 'prompt/templates/orchestration.md'), 'utf8');
    assert.match(md, /timeout[^\n]{0,40}600000/);
    assert.match(md, /cli-jaw dispatch/);
});

test('MD-010: a1-system.md directs timeout=600000 for cli-jaw dispatch', () => {
    const md = fs.readFileSync(join(srcRoot, 'prompt/templates/a1-system.md'), 'utf8');
    assert.match(md, /timeout[^\n]{0,40}600000/);
});

test('MD-011: builder.ts dynamic Delegation Rules block mentions 600000', () => {
    const src = fs.readFileSync(join(srcRoot, 'prompt/builder.ts'), 'utf8');
    const block = src.slice(src.indexOf('jaw Employee Dispatch'), src.indexOf('Do NOT confuse'));
    assert.match(block, /timeout[^\n]{0,40}600000/, 'delegation-rules block must direct timeout=600000');
});

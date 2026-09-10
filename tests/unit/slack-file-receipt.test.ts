import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendSlackFile } from '../../src/slack/slack-file.ts';
import { slackTargetFromId } from '../../src/messaging/slack-target.ts';

for (const [name, complete, status, expected] of [
    ['ack', { ok: true, files: [{ id: 'F123' }] }, 200, 'completed'],
    ['wrong file', { ok: true, files: [{ id: 'F999' }] }, 200, 'unknown'],
    ['completion without files echo', { ok: true }, 200, 'unknown'],
    ['HTTP failure despite JSON ok', { ok: true }, 503, 'unknown'],
    ['explicit refusal', { ok: false, error: 'missing_scope', needed: 'files:write' }, 200, 'failed'],
    ['invalid JSON', null, 200, 'unknown'],
] as const) test(`file receipt: ${name}`, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'jaw-file-receipt-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'note.txt'); writeFileSync(file, 'fixture'); const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
        calls.push(String(url));
        if (calls.length === 1) return new Response(JSON.stringify({ ok: true, upload_url: 'https://files.slack.com/upload/test', file_id: 'F123' }));
        if (calls.length === 2) { assert.equal(new Headers(init?.headers).has('Authorization'), false); return new Response('ok'); }
        return new Response(complete === null ? 'invalid' : JSON.stringify(complete), { status });
    };
    const result = await sendSlackFile('xoxb-test', slackTargetFromId('C1', { threadTs: '1.2' }), file, { fetchImpl });
    assert.equal(result.ok, expected === 'completed');
    const receipt = result as typeof result & { sent: boolean | 'unknown'; retryable: boolean; upload: Record<string, unknown> };
    assert.equal(receipt.sent, expected === 'completed' ? true : expected === 'unknown' ? 'unknown' : false);
    assert.equal(receipt.retryable, false);
    assert.deepEqual(receipt.upload, { stage: 'completion', state: expected, channelId: 'C1', threadTs: '1.2', fileId: 'F123', verification: 'not_checked' });
    assert.equal(calls.length, 3); assert.ok(!JSON.stringify(result).includes('https://')); assert.ok(!JSON.stringify(result).includes(dir));
});

for (const [point, expectedCalls, stage, sent] of [
    ['before', 0, 'validation', false],
    ['reserve', 1, 'reservation', false],
    ['bytes', 2, 'completion', false],
    ['complete', 3, 'completion', 'unknown'],
] as const) test(`file cancellation ${point} preserves known delivery state`, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'jaw-file-abort-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'note.txt'); writeFileSync(file, 'fixture'); const controller = new AbortController();
    let calls = 0; if (point === 'before') controller.abort();
    const fetchImpl: typeof fetch = async () => {
        calls++;
        if (point === 'reserve' && calls === 1 || point === 'bytes' && calls === 2 || point === 'complete' && calls === 3) controller.abort();
        if (calls === 1) return new Response(JSON.stringify({ ok: true, upload_url: 'https://files.slack.com/upload/test', file_id: 'F123' }));
        return new Response(calls === 2 ? 'ok' : JSON.stringify({ ok: true }));
    };
    const result = await sendSlackFile('xoxb-test', slackTargetFromId('C1'), file, { fetchImpl, signal: controller.signal });
    assert.equal(result.ok, false); assert.equal(result.sent, sent); assert.equal(result.upload.stage, stage); assert.equal(calls, expectedCalls);
});

test('lost completion reply retains reserved id without leaking capability URL or local path', async t => {
    const dir = mkdtempSync(join(tmpdir(), 'jaw-file-loss-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'note.txt'); writeFileSync(file, 'fixture'); let calls = 0;
    const fetchImpl: typeof fetch = async () => {
        calls++;
        if (calls === 1) return new Response(JSON.stringify({ ok: true, upload_url: 'https://files.slack.com/upload/test', file_id: 'F123' }));
        if (calls === 2) return new Response('ok');
        throw new Error('lost response');
    };
    const result = await sendSlackFile('xoxb-test', slackTargetFromId('C1'), file, { fetchImpl });
    assert.equal(result.sent, 'unknown'); assert.equal(result.upload.fileId, 'F123'); assert.equal(result.ok, false); assert.equal(calls, 3);
});


test('file removed after reservation does not disclose its local path', async t => {
    const dir = mkdtempSync(join(tmpdir(), 'jaw-file-read-failure-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'private-name.txt'); writeFileSync(file, 'fixture'); let calls = 0;
    const fetchImpl: typeof fetch = async () => {
        calls++; unlinkSync(file);
        return new Response(JSON.stringify({ ok: true, upload_url: 'https://files.slack.com/upload/test', file_id: 'F123' }));
    };
    const result = await sendSlackFile('xoxb-test', slackTargetFromId('C1'), file, { fetchImpl });
    assert.equal(result.ok, false); assert.equal(result.sent, false); assert.equal(result.upload.stage, 'upload');
    assert.equal(calls, 1); assert.equal(result.upload.fileId, 'F123');
    assert.ok(!JSON.stringify(result).includes(dir)); assert.ok(!JSON.stringify(result).includes('private-name.txt'));
});

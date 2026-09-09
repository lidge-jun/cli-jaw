import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { settings } from '../../src/core/config.ts';
import { createSlackForwarder } from '../../src/slack/forwarder.ts';

// #517 round 2: the forwarder posts text, then relays local images with a
// filename caption. Nothing executed that order or the caption before — bot
// tests mocked relaySlackImages to a no-op.

type Seen = { url: string; body: Record<string, unknown> };
function fakeFetch(log: Seen[]) {
    return (async (url: string | URL | Request, init?: RequestInit) => {
        let body: Record<string, unknown> = {};
        const raw = init?.body;
        if (typeof raw === 'string') { try { body = JSON.parse(raw); } catch { /* multipart */ } }
        log.push({ url: String(url), body });
        const payload = /getUploadURLExternal/.test(String(url))
            ? { ok: true, upload_url: 'https://files.slack.com/up', file_id: 'F1' }
            : { ok: true, ts: '1.1' };
        return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(payload) } as unknown as Response;
    }) as unknown as typeof fetch;
}

test('SFW-001: text goes first, then each image is relayed with its filename as caption', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sfw-')));
    const img = join(dir, 'chart.png');
    writeFileSync(img, 'png');
    const log: Seen[] = [];
    const priorFetch = globalThis.fetch;
    const priorWorkingDir = settings['workingDir'];
    globalThis.fetch = fakeFetch(log);
    settings['workingDir'] = dir;
    try {
        const forward = createSlackForwarder({
            getToken: () => 'xoxb-t',
            getLastTarget: () => ({ channel: 'slack', targetKind: 'channel', peerKind: 'channel', targetId: 'C1' }),
        });
        await forward('agent_done', { text: `done\n![chart](${img})` });
        assert.match(log[0]!.url, /chat\.postMessage/, 'the answer text is posted first');
        const complete = log.find((l) => /completeUploadExternal/.test(l.url));
        assert.ok(complete, 'the image was relayed');
        assert.equal(complete!.body['initial_comment'], 'chart.png');
        assert.ok(log.indexOf(complete!) > 0, 'relay happens after the text post');
    } finally {
        globalThis.fetch = priorFetch;
        settings['workingDir'] = priorWorkingDir;
    }
});

test('ordinary agent_done prose with a self-chosen table renders richly without format flags', async () => {
    const priorFetch = globalThis.fetch;
    const posts: Record<string, unknown>[] = [];
    const reads: URLSearchParams[] = [];
    const success: unknown[] = [];
    const table = '| 요금제 | 월 비용 | 인원 |\n| --- | --- | --- |\n| A | 20,000원 | 5명 |\n| B | 30,000원 | 10명 |';
    let omitStoredTable = false;
    globalThis.fetch = (async (url, init) => {
        if (String(url).endsWith('/chat.postMessage')) {
            posts.push(JSON.parse(String(init?.body)));
            return new Response(JSON.stringify({ ok: true, ts: `10.${posts.length}` }));
        }
        assert.ok(String(url).endsWith('/conversations.replies'));
        const params = new URLSearchParams(String(init?.body));
        reads.push(params);
        return new Response(JSON.stringify({ ok: true, messages: [{ ts: params.get('oldest'),
            blocks: omitStoredTable ? [] : [{ type: 'table', rows: [
                [{ type: 'raw_text', text: '요금제' }, { type: 'raw_text', text: '월 비용' }, { type: 'raw_text', text: '인원' }],
                [{ type: 'raw_text', text: 'A' }, { type: 'raw_text', text: '20,000원' }, { type: 'raw_text', text: '5명' }],
                [{ type: 'raw_text', text: 'B' }, { type: 'raw_text', text: '30,000원' }, { type: 'raw_text', text: '10명' }],
            ] }],
        }] }));
    }) as typeof fetch;
    try {
        const forward = createSlackForwarder({
            getToken: () => 'xoxb-fixture',
            getLastTarget: () => ({ channel: 'slack', targetKind: 'user', peerKind: 'direct', targetId: 'D1', threadId: '9.1' }),
            log: info => success.push(info),
        });
        // Only ordinary final text: no user request, blocks, table flag or skill invocation.
        await forward('agent_done', { text: `8명이라면 B가 적합합니다.\n\n${table}\n\nA는 인원이 부족합니다.` });
        assert.equal(posts.length, 1);
        assert.deepEqual(posts[0]!['blocks'], [{ type: 'markdown', text: `8명이라면 B가 적합합니다.\n\n${table}\n\nA는 인원이 부족합니다.` }]);
        assert.equal(reads.length, 1);
        assert.equal(reads[0]!.get('ts'), '9.1');
        assert.ok(posts.every(p => p['thread_ts'] === '9.1'));
        assert.equal(success.length, 1);
        omitStoredTable = true;
        await forward('agent_done', { text: table });
        assert.equal(success.length, 2, 'forwarding reports transport success independently of rendering verification');
        assert.equal(posts.length, 2, 'a verification mismatch never reposts the message');
        assert.equal(reads.length, 2, 'both posted messages still undergo verification');
    } finally {
        globalThis.fetch = priorFetch;
    }
});

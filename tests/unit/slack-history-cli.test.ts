import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Slack history CLI forwards all options and preserves pagination metadata', t => {
    const home = mkdtempSync(join(tmpdir(), 'slack-history-cli-'));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const preload = join(home, 'fetch.mjs');
    writeFileSync(preload, `globalThis.fetch = async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname !== '/api/slack/history') throw new Error('unexpected request');
        return new Response(JSON.stringify({ok:true,messages:[],hasMore:true,nextCursor:'next-page',partial:true,fetchedCount:0,contentTruncated:false,query:Object.fromEntries(parsed.searchParams)}));
    };`);
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', preload,
        'bin/cli-jaw.ts', 'slack', 'history', 'C1', '--thread', '1.0', '--limit', '2',
        '--cursor', 'page', '--oldest', '2.0', '--latest', '3.0', '--inclusive', '--json'], {
        cwd: join(import.meta.dirname, '../..'), encoding: 'utf8', timeout: 20000,
        env: { ...process.env, CLI_JAW_HOME: home, NODE_ENV: 'test' },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.query, { channel: 'C1', thread_ts: '1.0', limit: '2', cursor: 'page', oldest: '2.0', latest: '3.0', inclusive: 'true' });
    assert.equal(output.nextCursor, 'next-page'); assert.equal(output.partial, true);
});

test('typed Slack CLI attaches a turn grant and preserves failed publication receipts', t => {
    const home = mkdtempSync(join(tmpdir(), 'slack-tool-cli-'));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const preload = join(home, 'fetch.mjs');
    writeFileSync(preload, `globalThis.fetch = async (url, init) => {
        const parsed = new URL(url);
        if (parsed.pathname === '/api/auth/token') return new Response(JSON.stringify({token:'ordinary-fixture'}));
        if (parsed.pathname !== '/api/slack/tools' || init.method !== 'POST') throw new Error('unexpected request');
        if (init.headers['x-jaw-slack-grant'] !== 'fixture-turn-grant') throw new Error('missing grant');
        if (JSON.parse(init.body).operation !== 'search.quote') throw new Error('wrong operation');
        return new Response(JSON.stringify({ok:false,sent:'unknown',retryable:false,messageTs:['20.000001']}),{status:502});
    };`);
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', preload, 'bin/cli-jaw.ts', 'slack', 'tool',
        '--input-json', JSON.stringify({ operation: 'search.quote', invocationId: 'cli1', query: 'find' })], {
        cwd: join(import.meta.dirname, '../..'), encoding: 'utf8', timeout: 20000,
        env: { ...process.env, CLI_JAW_HOME: home, JAW_SLACK_TURN_GRANT: 'fixture-turn-grant', NODE_ENV: 'test' },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ok: false, sent: 'unknown', retryable: false, messageTs: ['20.000001'] });
    assert.ok(!result.stdout.includes('fixture-turn-grant'));
});

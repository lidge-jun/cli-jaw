import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
for (const [name, body, code] of [
    ['completed', { ok: true, sent: true, retryable: false, upload: { stage: 'completion', state: 'completed', verification: 'not_checked', channelId: 'C1', threadTs: '1.2', fileId: 'F1' } }, 0],
    ['legacy', { ok: true }, 1],
    ['ambiguous', { ok: false, sent: 'unknown', retryable: false, upload: { fileId: 'F1' } }, 1],
] as const) test(`Slack file CLI preserves ${name} receipt and sends once`, t => {
    const home = mkdtempSync(join(tmpdir(), 'jaw-file-cli-')); t.after(() => rmSync(home, { recursive: true, force: true }));
    const preload = join(home, 'fetch.mjs'); const record = join(home, 'calls.jsonl');
    writeFileSync(preload, `import {appendFileSync} from 'node:fs';globalThis.fetch=async(url,init)=>{appendFileSync(${JSON.stringify(record)},JSON.stringify({url,body:JSON.parse(init.body),grant:new Headers(init.headers).get('x-jaw-slack-grant')})+'\\n');return new Response(${JSON.stringify(JSON.stringify(body))});};`);
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', preload, 'bin/cli-jaw.ts', 'slack', 'send', 'C1', '--file', './note.txt', '--thread', '1.2', '--caption', 'caption', '--json'], {
        cwd: join(import.meta.dirname, '../..'), encoding: 'utf8', timeout: 20000,
        env: { ...process.env, CLI_JAW_HOME: home, NODE_ENV: 'test', JAW_SLACK_TURN_GRANT: 'fixture-grant' },
    });
    assert.equal(result.status, code, result.stderr); const output = JSON.parse(result.stdout);
    assert.equal(output.ok, code === 0); if (name === 'ambiguous') assert.deepEqual(output, body);
    if (name === 'legacy') assert.equal(output.error, 'slack_file_delivery_unconfirmed');
    const calls = readFileSync(record, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(calls.length, 1); assert.ok(calls[0].url.endsWith('/api/channel/send'));
    assert.equal(calls[0].grant, 'fixture-grant'); assert.equal(calls[0].body.target.targetId, 'C1');
    assert.equal(calls[0].body.target.threadId, '1.2'); assert.equal(calls[0].body.type, 'document');
    assert.ok(calls[0].body.file_path.endsWith('/note.txt')); assert.ok(!result.stdout.includes('fixture-grant'));
});

for (const args of [[], ['C1'], ['U1', '--file', 'x'], ['C1','--file','x','--thread','bad'], ['C1','--file','x','--limit','5'], ['C1','C2','--file','x']]) {
    test(`file CLI rejects invalid args before any network: ${JSON.stringify(args)}`, t => {
        const home = mkdtempSync(join(tmpdir(), 'jaw-file-args-')); t.after(() => rmSync(home, { recursive: true, force: true }));
        const preload = join(home, 'fetch.mjs'); writeFileSync(preload, 'globalThis.fetch=()=>{throw new Error("unexpected network")};');
        const result = spawnSync(process.execPath, ['--import','tsx','--import',preload,'bin/cli-jaw.ts','slack','send',...args], {
            cwd: join(import.meta.dirname, '../..'), encoding: 'utf8', timeout: 20000,
            env: { ...process.env, CLI_JAW_HOME: home, NODE_ENV: 'test' },
        });
        assert.equal(result.status, 1); const body = JSON.parse(result.stdout); assert.equal(body.sent, false); assert.equal(body.error,'slack_file_send_arguments_invalid');
    });
}

for (const mode of ['root','lost','malformed','http-error','missing-operator']) test(`file CLI ${mode} keeps destination and uncertainty`, t => {
    const home = mkdtempSync(join(tmpdir(), 'jaw-file-result-')); t.after(() => rmSync(home, { recursive: true, force: true }));
    const preload = join(home, 'fetch.mjs'); const record = join(home, 'calls');
    const success = { ok: true, sent: true, retryable: false, upload: { stage: 'completion', state: 'completed', verification: 'not_checked', channelId: 'C1', fileId: 'F1' } };
    writeFileSync(preload, `import {writeFileSync} from 'node:fs';globalThis.fetch=async(url,init)=>{writeFileSync(${JSON.stringify(record)},init.body);${mode === 'lost' ? 'throw new Error("network failure");' : `return new Response(${JSON.stringify(mode === 'malformed' ? 'bad json' : JSON.stringify(success))},{status:${mode === 'http-error' ? 503 : 200}});`}};`);
    const result = spawnSync(process.execPath, ['--import','tsx','--import',preload,'bin/cli-jaw.ts','slack','send','C1','--file','note.txt',...(mode === 'missing-operator' ? ['--operator'] : [])], {
        cwd: join(import.meta.dirname, '../..'), encoding: 'utf8', timeout: 20000,
        env: { ...process.env, CLI_JAW_HOME: home, NODE_ENV: 'test' },
    });
    const body = JSON.parse(result.stdout); assert.equal(result.status, mode === 'root' ? 0 : 1);
    assert.equal(body.sent, mode === 'missing-operator' ? false : mode === 'root' || mode === 'http-error' ? true : 'unknown');
    if (mode === 'missing-operator') assert.throws(() => readFileSync(record));
    else { const posted = JSON.parse(readFileSync(record, 'utf8')); assert.equal(posted.target.threadId, ''); assert.equal(posted.target.targetId, 'C1'); }
});

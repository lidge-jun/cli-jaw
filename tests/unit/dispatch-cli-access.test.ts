import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function runCli(scenario: string, args: string[] = [], worker = false) {
    const root = mkdtempSync(join(tmpdir(), 'jaw-dispatch-cli-'));
    const calls = join(root, 'calls.jsonl');
    const preload = join(root, 'fetch.mjs');
    writeFileSync(preload, `import { appendFileSync } from 'node:fs';
const scenario = ${JSON.stringify(scenario)};
globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ path, method: init.method || 'GET', headers: init.headers, body: init.body ? JSON.parse(init.body) : null }) + '\\n');
    if (path === '/api/auth/token') return new Response('{"token":"fixture"}');
    if (path === '/api/orchestrate/access') {
        if (scenario === 'transport') throw new Error('fixture private transport detail');
        if (/^\\d+$/.test(scenario)) return new Response('fixture', { status: Number(scenario) });
        if (scenario === 'malformed') return new Response('{');
        if (scenario === 'unknown') return new Response('{"dispatch":{"path":"unknown"}}');
        return Response.json({ dispatch: { path: 'direct' } });
    }
    return new Response('{"error":"fixture dispatch ended"}', { status: 403 });
};`);
    const output: string[] = [];
    try {
        const child = spawn(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(preload).href,
            resolve('bin/commands/dispatch.ts'), '--virtual', 'fixture', '--task', 'fixture', '--quiet', ...args], {
            env: { ...process.env, CLI_JAW_HOME: root, JAW_BOSS_TOKEN: '',
                JAW_EMPLOYEE_MODE: worker ? '1' : '', JAW_ASSIGNMENT_ALLOW_DISPATCH: '1',
                JAW_ASSIGNMENT_SCOPE_KEY: 'local:fixture', JAW_ASSIGNMENT_CHAT_SESSION_ID: 'fixture',
                JAW_ASSIGNMENT_PARENT_REQUEST_ID: 'wr_fixture' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.on('data', b => output.push(String(b)));
        child.stderr.on('data', b => output.push(String(b)));
        const code = await new Promise<number | null>((done, reject) => {
            child.on('error', reject); child.on('close', done);
        });
        const requests = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
        return { code, requests, output: output.join('') };
    } finally { rmSync(root, { recursive: true, force: true }); }
}

for (const scenario of ['401', '403', '500', 'transport', 'malformed', 'unknown']) {
    for (const batch of [false, true]) test(`CLI ${batch ? 'batch' : 'single'} discovery ${scenario} makes zero POSTs`, async () => {
        const result = await runCli(scenario, batch ? ['--batch', '--agents', '[{"virtual":"fixture","task":"fixture"}]'] : []);
        assert.equal(result.code, 1);
        assert.equal(result.requests.filter(r => r.method === 'POST').length, 0);
        assert.match(result.output, /dispatch_access_discovery_failed/);
        assert.doesNotMatch(result.output, /private transport detail/);
    });
}

test('only a real 404 preserves pending fallback', async () => {
    const result = await runCli('404');
    assert.deepEqual(result.requests.filter(r => r.method === 'POST').map(r => r.path), ['/api/orchestrate/dispatch/pending']);
});

test('direct worker sends stable selectors while main ignores pooled env; mutable omission preserved', async () => {
    const worker = await runCli('direct', ['--read-only', '--no-descendants'], true);
    const post = worker.requests.find(r => r.method === 'POST');
    assert.equal(post.path, '/api/orchestrate/dispatch');
    assert.equal(post.body.mutable, false);
    assert.equal(post.body.noDescendants, true);
    assert.equal(post.body.requestId, 'wr_fixture');
    assert.equal(post.headers['x-jaw-employee-mode'], '1');
    const main = await runCli('direct');
    const body = main.requests.find(r => r.method === 'POST').body;
    assert.equal(Object.hasOwn(body, 'mutable'), false);
    assert.equal(Object.hasOwn(body, 'requestId'), false);
});

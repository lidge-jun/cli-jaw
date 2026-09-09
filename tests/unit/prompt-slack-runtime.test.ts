import '../setup/isolated-home.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import { JAW_HOME, PROMPTS_DIR, settings } from '../../src/core/config.ts';
import { initPromptFiles, regenerateB, getSystemPrompt, getGeneratedPromptProof } from '../../src/prompt/builder.ts';
import { registerSettingsRoutes } from '../../src/routes/settings.ts';

const workingDir = join(JAW_HOME, 'private-work');
const a1 = join(PROMPTS_DIR, 'A-1.md'); const a2 = join(PROMPTS_DIR, 'A-2.md');
const b = join(PROMPTS_DIR, 'B.md'); const agents = join(workingDir, 'AGENTS.md');
const marker = '<!-- anchor:slack-typed-tools-v1 -->';
function setup() {
    settings.workingDir = workingDir;
    fs.mkdirSync(PROMPTS_DIR, { recursive: true }); fs.mkdirSync(workingDir, { recursive: true });
    fs.writeFileSync(a1, '# fixture system\n'); fs.writeFileSync(a2, '# original user\r\n한글  \r\n');
}
test('startup appends Slack anchor once without changing customized bytes or A2', () => {
    setup(); initPromptFiles();
    const hash = fs.readFileSync(a1 + '.hash', 'utf8');
    const original = '# CUSTOM\r\n사용자 지침  \r\n<!-- anchor:slack-typed-tools-v0 -->\nold\n';
    const user = fs.readFileSync(a2);
    fs.writeFileSync(a1, original); fs.writeFileSync(a1 + '.hash', hash);
    initPromptFiles();
    const migrated = fs.readFileSync(a1, 'utf8');
    assert.equal(migrated.slice(0, original.length), original);
    const template = fs.readFileSync(join(process.cwd(), 'src/prompt/templates/a1-system.md'), 'utf8');
    const close = '<!-- /anchor:slack-typed-tools-v1 -->';
    const block = template.slice(template.indexOf(marker), template.indexOf(close) + close.length);
    assert.equal(migrated.slice(original.length), '\n' + block + '\n');
    initPromptFiles(); assert.equal(fs.readFileSync(a1, 'utf8'), migrated);
    assert.deepEqual(fs.readFileSync(a2), user);
});
test('regeneration preserves unchanged files but repairs missing or tampered artifacts', () => {
    setup(); regenerateB(); const expected = getSystemPrompt({ forDisk: true });
    fs.utimesSync(b, 100, 100); fs.utimesSync(agents, 100, 100);
    regenerateB(); assert.equal(fs.statSync(b).mtimeMs, 100000); assert.equal(fs.statSync(agents).mtimeMs, 100000);
    fs.unlinkSync(agents); regenerateB(); assert.equal(fs.readFileSync(agents, 'utf8'), expected);
    fs.writeFileSync(b, 'tampered'); regenerateB(); assert.equal(fs.readFileSync(b, 'utf8'), expected);
    fs.unlinkSync(b); regenerateB(); assert.equal(fs.readFileSync(b, 'utf8'), expected);
});
test('AGENTS failure preserves caught-error contract and same-prompt retry repairs output', t => {
    setup(); fs.writeFileSync(a2, 'failure fixture unique');
    const write = fs.writeFileSync; let attempts = 0;
    const mock = t.mock.method(fs, 'writeFileSync', (...args: Parameters<typeof fs.writeFileSync>) => {
        if (String(args[0]) === agents && ++attempts === 1) throw new Error('fixture denied');
        return write(...args);
    });
    assert.doesNotThrow(() => regenerateB()); regenerateB();
    assert.equal(attempts, 2); assert.deepEqual(fs.readFileSync(b), fs.readFileSync(agents)); mock.mock.restore();
});
test('B write failure still throws and does not poison retry cache', t => {
    setup(); fs.writeFileSync(a2, 'B failure unique');
    const write = fs.writeFileSync; let attempts = 0;
    t.mock.method(fs, 'writeFileSync', (...args: Parameters<typeof fs.writeFileSync>) => {
        if (String(args[0]) === b && ++attempts === 1) throw new Error('fixture B denied');
        return write(...args);
    });
    assert.throws(() => regenerateB(), /fixture B denied/); regenerateB();
    assert.equal(attempts, 2); assert.deepEqual(fs.readFileSync(b), fs.readFileSync(agents));
});
test('official PUT roundtrips complete A2 and regenerates private B/AGENTS', async () => {
    setup(); const app = express(); app.use(express.json());
    registerSettingsRoutes(app, (_req, _res, next) => next(), async () => ({}), process.cwd());
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    try {
        const address = server.address(); assert.ok(address && typeof address !== 'string');
        const url = `http://127.0.0.1:${address.port}/api/prompt`;
        const original = (await (await fetch(url)).json()).content as string;
        const content = original + '\nfixture suffix "literal" \\n $() `code`\n';
        const response = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) });
        assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
        assert.equal((await (await fetch(url)).json()).content, content);
        assert.equal(fs.readFileSync(a2, 'utf8'), content);
        const expected = getSystemPrompt({ forDisk: true });
        assert.equal(fs.readFileSync(b, 'utf8'), expected); assert.equal(fs.readFileSync(agents, 'utf8'), expected);
        assert.equal(createHash('sha256').update(fs.readFileSync(a2)).digest('hex'), createHash('sha256').update(content).digest('hex'));
        const invalid = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' });
        assert.equal(invalid.status, 400); assert.equal(fs.readFileSync(a2, 'utf8'), content);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

// Invoke the registered production handler without replacing its implementation.
// This is handler evidence only; the separate HTTP test above owns wire evidence.
test('official prompt handlers preserve full A2 and repair same-content failed/missing outputs', t => {
    setup();
    type Handler = (req: { body: unknown; query?: Record<string, unknown> }, res: { status(code: number): unknown; json(value: unknown): unknown }) => unknown;
    const handlers = new Map<string, Handler>();
    const capture = (method: string) => (path: string, ...callbacks: unknown[]) => handlers.set(method + path, callbacks.at(-1) as Handler);
    const app = { get: capture('GET'), put: capture('PUT'), post: capture('POST') };
    registerSettingsRoutes(app as unknown as express.Express, (_req, _res, next) => next(), async () => ({}), process.cwd());
    const invoke = (method: string, body: unknown = {}) => {
        let status = 200; let value: unknown;
        const res = { status(code: number) { status = code; return res; }, json(result: unknown) { value = result; return res; } };
        handlers.get(method + '/api/prompt')!({ body, query: {} }, res); return { status, value };
    };
    const original = fs.readFileSync(a2, 'utf8'); const content = original + '\nfixture preserved suffix\n';
    const write = fs.writeFileSync; let deny = true;
    const mock = t.mock.method(fs, 'writeFileSync', (...args: Parameters<typeof fs.writeFileSync>) => {
        if (String(args[0]) === agents && deny) throw new Error('fixture AGENTS denied');
        return write(...args);
    });
    assert.deepEqual(invoke('PUT', { content }), { status: 200, value: { ok: true } });
    assert.equal(fs.readFileSync(a2, 'utf8'), content);
    deny = false; assert.deepEqual(invoke('PUT', { content }).value, { ok: true });
    assert.deepEqual(fs.readFileSync(b), fs.readFileSync(agents));
    fs.unlinkSync(agents); invoke('PUT', { content });
    assert.equal(fs.readFileSync(agents, 'utf8'), getSystemPrompt({ forDisk: true }));
    assert.deepEqual(invoke('GET').value, { content });
    assert.equal(invoke('PUT', {}).status, 400);
    assert.equal(fs.readFileSync(a2, 'utf8'), content); mock.mock.restore();
});

test('enhanced official GET proves transformed Working Directory without exposing generated body', t => {
    setup();
    const content = '# User\r\n\r\n## Working Directory\r\n- ~/.cli-jaw\r\n\r\nSYNTHETIC_A2_CANARY\r\n';
    type Handler = (req: { body: unknown; query: Record<string, unknown> }, res: { json(value: unknown): unknown }) => unknown;
    const routes = new Map<string, Handler>();
    const capture = (method: string) => (path: string, ...callbacks: unknown[]) => routes.set(method + path, callbacks.at(-1) as Handler);
    const app = { get: capture('GET'), put: capture('PUT'), post: capture('POST') };
    let guards = 0;
    const auth = () => { guards++; };
    // Registration preserves requireAuth as the first handler for both GET forms.
    const get = app.get;
    app.get = (path: string, ...callbacks: unknown[]) => { if (path === '/api/prompt') assert.equal(callbacks[0], auth); return get(path, ...callbacks); };
    registerSettingsRoutes(app as unknown as express.Express, auth, async () => ({}), process.cwd());
    const invoke = (method: string, query: Record<string, unknown> = {}, body: unknown = {}) => {
        let value: unknown; routes.get(method + '/api/prompt')!({ body, query }, { json(result) { value = result; } }); return value;
    };
    assert.deepEqual(invoke('PUT', {}, { content }), { ok: true });
    assert.equal(fs.readFileSync(a2, 'utf8'), content);
    assert.equal(fs.readFileSync(b, 'utf8').includes(content), false, 'raw A2 is intentionally transformed on disk');
    const bytes = fs.readFileSync(b); const mtime = [fs.statSync(b).mtimeMs, fs.statSync(agents).mtimeMs];
    const read = fs.readFileSync; let a1Reads = 0;
    t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
        if (String(args[0]) === a1) a1Reads++;
        return read(...args);
    });
    const enhanced = invoke('GET', { withGenerated: '1' }) as { content: string; generated: unknown };
    assert.equal(a1Reads, 1, 'one generation for the two output checks');
    assert.equal(enhanced.content, content);
    assert.deepEqual(enhanced.generated, { version: 1, expectedSha256: createHash('sha256').update(bytes).digest('hex'), expectedBytes: bytes.length,
        bMatches: true, agentsMatches: true, bState: 'matched', agentsState: 'matched' });
    assert.equal(JSON.stringify(enhanced.generated).includes(JAW_HOME), false);
    assert.equal(JSON.stringify(enhanced.generated).includes('SYNTHETIC'), false);
    assert.deepEqual([fs.statSync(b).mtimeMs, fs.statSync(agents).mtimeMs], mtime);
    for (const query of [{}, { withGenerated: '0' }, { withGenerated: ['1'] }]) assert.deepEqual(invoke('GET', query), { content });
    assert.equal(guards, 0, 'direct-handler fixture does not claim HTTP auth execution');
});
test('generated proof bounds mismatched files and distinguishes missing/unreadable without writing', t => {
    setup(); regenerateB();
    fs.writeFileSync(b, 'different size');
    const open = fs.openSync; let bOpens = 0;
    t.mock.method(fs, 'openSync', (...args: Parameters<typeof fs.openSync>) => {
        if (String(args[0]) === b) bOpens++;
        return open(...args);
    });
    assert.equal(getGeneratedPromptProof().bState, 'mismatched'); assert.equal(bOpens, 0);
    fs.unlinkSync(b); assert.equal(getGeneratedPromptProof().bState, 'missing');
    fs.mkdirSync(b); const unreadable = getGeneratedPromptProof();
    assert.equal(unreadable.bState, 'unreadable'); assert.equal(unreadable.bMatches, null);
    fs.rmdirSync(b); regenerateB();
    const data = fs.readFileSync(agents); data[0] = data[0] === 65 ? 66 : 65; fs.writeFileSync(agents, data);
    const mismatch = getGeneratedPromptProof(); assert.equal(mismatch.agentsState, 'mismatched'); assert.equal(mismatch.agentsMatches, false);
    fs.unlinkSync(agents); assert.equal(getGeneratedPromptProof().agentsState, 'missing');
});
test('generation error is explicit and does not leak exception or expected content', t => {
    setup(); const read = fs.readFileSync;
    t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
        if (String(args[0]) === a1) throw new Error('SYNTHETIC_SECRET_PATH');
        return read(...args);
    });
    assert.deepEqual(getGeneratedPromptProof(), { version: 1, expectedSha256: null, expectedBytes: null, bMatches: null, agentsMatches: null,
        bState: 'unreadable', agentsState: 'unreadable', error: 'generation_failed' });
});

test('same-hash regeneration repairs oversized B without an unbounded read', t => {
    setup(); regenerateB();
    const expected = fs.readFileSync(b);
    const fd = fs.openSync(b, 'r+');
    try { fs.ftruncateSync(fd, expected.length + 8 * 1024 * 1024); }
    finally { fs.closeSync(fd); }
    const read = fs.readFileSync; let unboundedReads = 0;
    const spy = t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
        if (String(args[0]) === b) {
            unboundedReads++;
            throw new Error('fixture: oversized B must not be read wholesale');
        }
        return read(...args);
    });
    regenerateB();
    // Also assert the attempt count: swallowing the spy error and repairing is insufficient.
    assert.equal(unboundedReads, 0);
    spy.mock.restore();
    assert.deepEqual(fs.readFileSync(b), expected);
    assert.deepEqual(fs.readFileSync(agents), expected);
});

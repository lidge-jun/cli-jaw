// Settings failure surface tests — Phase 9
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');
const serverSrc = readFileSync(join(projectRoot, 'server.ts'), 'utf8');
const runtimeSettingsSrc = readFileSync(join(projectRoot, 'src/core/runtime-settings.ts'), 'utf8');

// ─── Source wiring checks ────────────────────────────

test('PUT /api/settings uses asyncHandler for error surface', () => {
    assert.ok(serverSrc.includes("app.put('/api/settings', asyncHandler("),
        'PUT /api/settings must use asyncHandler wrapper');
});

test('server wires errorHandler middleware', () => {
    assert.ok(serverSrc.includes('app.use(errorHandler'),
        'server must wire errorHandler as last middleware');
});

test('applyRuntimeSettingsPatch re-throws after rollback', () => {
    assert.match(runtimeSettingsSrc, /throw e/,
        'must re-throw to surface error to caller');
});

// ─── Behavior: asyncHandler catches rejected promises ─

test('asyncHandler forwards rejected promise to Express next()', async () => {
    const { asyncHandler } = await import('../../src/http/async-handler.js');
    const testError = new Error('test-restart-failure');
    const handler = asyncHandler(async () => { throw testError; });

    let capturedError: unknown = null;
    const fakeReq = {} as any;
    const fakeRes = {} as any;
    const fakeNext = (err: unknown) => { capturedError = err; };

    handler(fakeReq, fakeRes, fakeNext);
    // asyncHandler wraps in Promise.resolve().catch(next), so wait a tick
    await new Promise(r => setTimeout(r, 10));

    assert.equal(capturedError, testError,
        'asyncHandler must forward thrown errors to next()');
});

// ─── Behavior: errorHandler returns JSON error ───────

test('errorHandler returns structured JSON error response', async () => {
    const { errorHandler } = await import('../../src/http/error-middleware.js');

    let statusCode = 0;
    let responseBody: any = null;
    const fakeReq = { path: '/api/settings' } as any;
    const fakeRes = {
        headersSent: false,
        status(code: number) { statusCode = code; return this; },
        json(body: any) { responseBody = body; return this; },
    } as any;
    const fakeNext = () => {};

    errorHandler({ statusCode: 500, message: 'restart failed' }, fakeReq, fakeRes, fakeNext);

    assert.equal(statusCode, 500, 'should return 500');
    assert.ok(responseBody, 'should return JSON body');
    assert.equal(responseBody.ok, false, 'should have ok: false');
});

// ─── Behavior: errorHandler handles custom statusCode ─

test('errorHandler uses error statusCode when provided', async () => {
    const { errorHandler } = await import('../../src/http/error-middleware.js');

    let statusCode = 0;
    const fakeReq = { path: '/api/settings' } as any;
    const fakeRes = {
        headersSent: false,
        status(code: number) { statusCode = code; return this; },
        json() { return this; },
    } as any;

    errorHandler({ statusCode: 413, message: 'too large' }, fakeReq, fakeRes, () => {});
    assert.equal(statusCode, 413, 'should use error statusCode');
});

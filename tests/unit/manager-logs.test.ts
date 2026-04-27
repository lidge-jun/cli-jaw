import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchInstanceLogs } from '../../src/manager/logs.ts';
import type { FetchLike } from '../../src/manager/types.ts';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

test('logs.fetch prefers /api/runtime?logs=tail when available', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
        calls.push(url);
        if (url.includes('/api/runtime?logs=tail')) {
            return jsonResponse({
                lines: [
                    { ts: '2026-04-28T00:00:00Z', level: 'info', text: 'boot' },
                    { ts: '2026-04-28T00:00:01Z', level: 'warn', text: 'slow' },
                ],
            });
        }
        return jsonResponse({}, 404);
    };
    const snapshot = await fetchInstanceLogs(3457, { fetchImpl, timeoutMs: 100 });
    assert.equal(snapshot.source, 'runtime');
    assert.equal(snapshot.lines.length, 2);
    assert.equal(snapshot.lines[1].level, 'warn');
    assert.equal(calls[0].includes('/api/runtime?logs=tail'), true);
});

test('logs.fetch falls back to /api/health when runtime is missing', async () => {
    const fetchImpl: FetchLike = async (url) => {
        if (url.includes('/api/runtime')) return jsonResponse({}, 404);
        if (url.includes('/api/health')) {
            return jsonResponse({ logs: [{ message: 'health note', level: 'info' }] });
        }
        return jsonResponse({}, 404);
    };
    const snapshot = await fetchInstanceLogs(3458, { fetchImpl, timeoutMs: 100 });
    assert.equal(snapshot.source, 'health');
    assert.equal(snapshot.lines.length, 1);
    assert.equal(snapshot.lines[0].text, 'health note');
});

test('logs.fetch returns empty snapshot with reason when both sources fail', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({}, 500);
    const snapshot = await fetchInstanceLogs(3459, { fetchImpl, timeoutMs: 50 });
    assert.equal(snapshot.source, 'none');
    assert.equal(snapshot.lines.length, 0);
    assert.ok(snapshot.reason);
});

test('logs.fetch caps lines at 200 and reports truncation', async () => {
    const lines = Array.from({ length: 250 }, (_, i) => ({ ts: `2026-04-28T00:00:${String(i).padStart(2, '0')}Z`, level: 'info', text: `line ${i}` }));
    const fetchImpl: FetchLike = async (url) => {
        if (url.includes('/api/runtime')) return jsonResponse({ lines });
        return jsonResponse({}, 404);
    };
    const snapshot = await fetchInstanceLogs(3460, { fetchImpl, timeoutMs: 100 });
    assert.equal(snapshot.lines.length, 200);
    assert.equal(snapshot.truncated, true);
    assert.equal(snapshot.lines[0].text, 'line 50');
});

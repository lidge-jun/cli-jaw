import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import express from 'express';
import { createJawCeoRouter } from '../../src/routes/jaw-ceo.js';
import { settings } from '../../src/core/config.js';

async function withJawCeoServer(fn: (baseUrl: string) => Promise<void>, expectedSent: string[] = []): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'cli-jaw-ceo-routes-'));
    const app = express();
    const server = http.createServer(app);
    const sent: string[] = [];
    let latestId = 40;
    const finalText = '## Patched dispatch\n\nThis is the real final worker response.';
    app.use(express.json());
    app.use('/api/jaw-ceo', createJawCeoRouter({
        repoRoot: dir,
        now: () => new Date('2026-05-10T00:00:00.000Z'),
        fetchLatestMessage: async () => ({
            latestAssistant: {
                id: latestId,
                role: 'assistant',
                created_at: '2026-05-10T00:00:00.000Z',
                ...(latestId > 40 ? { text: finalText } : {}),
            },
            activity: null,
        }),
        sendWorkerMessage: async ({ prompt }) => {
            sent.push(prompt);
            latestId = 41;
            return { ok: true, message: 'sent', data: { queued: true } };
        },
    }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        settings["jawCeo"] = { openaiApiKey: '' };
        const address = server.address();
        assert.equal(typeof address, 'object');
        assert.ok(address);
        await fn(`http://127.0.0.1:${address.port}`);
        assert.deepEqual(sent, expectedSent);
    } finally {
        settings["jawCeo"] = { openaiApiKey: '' };
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        rmSync(dir, { recursive: true, force: true });
    }
}

async function json<T>(response: Response): Promise<T> {
    assert.equal(response.headers.get('content-type')?.includes('application/json'), true);
    return await response.json() as T;
}

test('jaw-ceo routes expose state and server-owned pending completion flow', async () => {
    await withJawCeoServer(async (baseUrl) => {
        const state = await json<{ ok: boolean; data: { session: { sessionId: string }; transcript: unknown[] } }>(await fetch(`${baseUrl}/api/jaw-ceo/state`));
        assert.equal(state.ok, true);
        assert.match(state.data.session.sessionId, /^jaw-ceo-/);
        assert.deepEqual(state.data.transcript, []);

        const sent = await json<{ ok: boolean; data: { ok: boolean; data: { pending: unknown[] } } }>(await fetch(`${baseUrl}/api/jaw-ceo/message`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'ship it', selectedPort: 3457, responseMode: 'text' }),
        }));
        assert.equal(sent.ok, true);
        assert.equal(sent.data.ok, true);
        assert.equal(sent.data.data.pending.length, 0);

        const afterMessage = await json<{ ok: boolean; data: { transcript: Array<{ role: string; text: string }> } }>(await fetch(`${baseUrl}/api/jaw-ceo/state`));
        assert.equal(afterMessage.data.transcript[0]?.role, 'user');
        assert.equal(afterMessage.data.transcript[0]?.text, 'ship it');
        assert.equal(afterMessage.data.transcript[1]?.role, 'ceo');
        assert.match(afterMessage.data.transcript[1]?.text || '', /registered a completion watch/);

        const refreshed = await json<{ ok: boolean; data: { pending: Array<{ completionKey: string; port: number; resultText?: string; summary?: string }> } }>(await fetch(`${baseUrl}/api/jaw-ceo/events/refresh`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ports: [3457] }),
        }));
        assert.equal(refreshed.data.pending[0]?.port, 3457);
        assert.match(refreshed.data.pending[0]?.summary || '', /Patched dispatch/);
        assert.match(refreshed.data.pending[0]?.resultText || '', /real final worker response/);

        const key = refreshed.data.pending[0]?.completionKey;
        assert.ok(key);
        const summarized = await json<{ ok: boolean; data: { ok: boolean; data: { summary: string } } }>(await fetch(`${baseUrl}/api/jaw-ceo/pending/${key}/summarize`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ format: 'short' }),
        }));
        assert.equal(summarized.ok, true);
        assert.match(summarized.data.data.summary, /Patched dispatch/);

        const afterSummary = await json<{ ok: boolean; data: { transcript: Array<{ role: string; text: string }> } }>(await fetch(`${baseUrl}/api/jaw-ceo/state`));
        assert.match(afterSummary.data.transcript.at(-1)?.text || '', /Patched dispatch/);

        const continued = await json<{ ok: boolean; data: { ok: boolean; data: { response: string }; untrustedText?: string } }>(await fetch(`${baseUrl}/api/jaw-ceo/pending/${key}/continue`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'text' }),
        }));
        assert.equal(continued.ok, true);
        assert.match(continued.data.data.response, /real final worker response/);
        assert.match(continued.data.untrustedText || '', /real final worker response/);

        const silent = await json<{ ok: boolean; data: { ok: boolean; data: unknown; untrustedText?: string } }>(await fetch(`${baseUrl}/api/jaw-ceo/pending/${key}/continue`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'silent' }),
        }));
        assert.equal(silent.ok, true);
        assert.equal(JSON.stringify(silent).includes('real final worker response'), false);
        assert.equal(silent.data.untrustedText, undefined);
    }, ['[from: Jaw CEO]\nship it']);
});

test('jaw-ceo voice route fails closed when API key is absent', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
        await withJawCeoServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/jaw-ceo/voice/connect`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ offerSdp: 'v=0' }),
            });
            const body = await json<{ ok: boolean; code: string; message: string }>(response);
            assert.equal(response.status, 503);
            assert.equal(body.ok, false);
            assert.equal(body.code, 'voice_disabled');
        });
    } finally {
        if (prev === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = prev;
    }
});

test('jaw-ceo settings route stores and masks voice API key', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
        await withJawCeoServer(async (baseUrl) => {
            const savedResponse = await fetch(`${baseUrl}/api/jaw-ceo/settings`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ openaiApiKey: 'OPENAI_API_KEY=sk-test-jaw-ceo-1234' }),
            });
            const savedText = await savedResponse.text();
            assert.equal(savedText.includes('sk-test-jaw-ceo-1234'), false);
            const saved = JSON.parse(savedText) as { ok: boolean; data: { openaiKeySet: boolean; openaiKeyLast4: string; openaiKeySource: string } };
            assert.equal(saved.ok, true);
            assert.equal(saved.data.openaiKeySet, true);
            assert.equal(saved.data.openaiKeyLast4, '1234');
            assert.equal(saved.data.openaiKeySource, 'settings');
            assert.equal(saved.data.openaiKeyInvalid, false);

            const state = await json<{ ok: boolean; data: { voice: { status: string; error: string | null } } }>(await fetch(`${baseUrl}/api/jaw-ceo/state`));
            assert.equal(state.data.voice.status, 'idle');
            assert.equal(state.data.voice.error, null);
        });
    } finally {
        if (prev === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = prev;
    }
});

test('jaw-ceo settings route rejects non-key text instead of saving broken auth', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
        await withJawCeoServer(async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/jaw-ceo/settings`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ openaiApiKey: 'not found)' }),
            });
            const body = await json<{ ok: boolean; code: string }>(response);
            assert.equal(response.status, 400);
            assert.equal(body.ok, false);
            assert.equal(body.code, 'invalid_openai_api_key');

            settings["jawCeo"] = { openaiApiKey: 'not found)' };
            const current = await json<{ ok: boolean; data: { openaiKeySet: boolean; openaiKeyInvalid: boolean } }>(await fetch(`${baseUrl}/api/jaw-ceo/settings`));
            assert.equal(current.data.openaiKeySet, false);
            assert.equal(current.data.openaiKeyInvalid, true);
        });
    } finally {
        if (prev === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = prev;
    }
});

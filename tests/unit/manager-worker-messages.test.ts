import assert from 'node:assert/strict';
import test from 'node:test';
import {
    extractWorkerMessageRows,
    fetchWorkerAssistantTextById,
    findWorkerAssistantText,
} from '../../src/manager/worker-messages.ts';

test('worker message helper unwraps current and legacy message response shapes', () => {
    const current = extractWorkerMessageRows({
        ok: true,
        data: [
            { id: 1, role: 'user', content: 'ask', created_at: '2026-05-10 07:20:00' },
            { id: '2', role: 'assistant', content: 'answer', created_at: '2026-05-10 07:21:00' },
        ],
    });
    const legacy = extractWorkerMessageRows([
        { id: 3, role: 'assistant', content: 'legacy answer' },
    ]);

    assert.deepEqual(current.map(row => [row.id, row.role, row.content]), [
        [1, 'user', 'ask'],
        [2, 'assistant', 'answer'],
    ]);
    assert.deepEqual(legacy.map(row => [row.id, row.role, row.content]), [
        [3, 'assistant', 'legacy answer'],
    ]);
});

test('worker message helper finds assistant content by id only', () => {
    const rows = extractWorkerMessageRows({
        ok: true,
        data: [
            { id: 10, role: 'user', content: 'same id user text' },
            { id: 11, role: 'assistant', content: 'assistant text' },
        ],
    });

    assert.equal(findWorkerAssistantText(rows, 10), '');
    assert.equal(findWorkerAssistantText(rows, 11), 'assistant text');
});

test('worker message fetch fallback reads assistant text from full message history', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
        calls.push(url);
        return {
            ok: true,
            json: async () => ({
                ok: true,
                data: [
                    { id: 40, role: 'user', content: 'new prompt' },
                    { id: 41, role: 'assistant', content: 'final answer body' },
                ],
            }),
        };
    };

    assert.equal(await fetchWorkerAssistantTextById(fetchImpl, 3468, 41), 'final answer body');
    assert.deepEqual(calls, ['http://127.0.0.1:3468/api/messages']);
});

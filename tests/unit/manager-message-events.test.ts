import assert from 'node:assert/strict';
import test from 'node:test';
import {
    latestAssistantFromEnvelope,
    notifiableAssistantFromEnvelope,
    type MessageEnvelope,
} from '../../public/manager/src/hooks/useInstanceMessageEvents.ts';

test('latest envelope keeps assistant baseline but waits for notifiable assistant activity', () => {
    const inProgress: MessageEnvelope['data'] = {
        latestAssistant: { id: 42, role: 'assistant', created_at: '2026-04-30T13:30:00.000Z' },
        activity: null,
    };

    assert.equal(latestAssistantFromEnvelope(inProgress)?.id, 42);
    assert.equal(notifiableAssistantFromEnvelope(inProgress), null);
});

test('latest envelope ignores user activity for unread assistant notifications', () => {
    const userActivity: MessageEnvelope['data'] = {
        latestAssistant: { id: 42, role: 'assistant', created_at: '2026-04-30T13:30:00.000Z' },
        activity: {
            messageId: 41,
            role: 'user',
            title: 'asking while response is still pending',
            updatedAt: '2026-04-30T13:29:59.000Z',
        },
    };

    assert.equal(notifiableAssistantFromEnvelope(userActivity), null);
});

test('latest envelope emits unread notification only when assistant activity matches latest assistant', () => {
    const completed: MessageEnvelope['data'] = {
        latestAssistant: { id: 43, role: 'assistant', created_at: '2026-04-30T13:31:00.000Z' },
        activity: {
            messageId: 43,
            role: 'assistant',
            title: 'finished response',
            updatedAt: '2026-04-30T13:31:00.000Z',
        },
    };

    assert.equal(notifiableAssistantFromEnvelope(completed)?.id, 43);
});

test('legacy latest endpoint remains id-based for old runtimes', () => {
    const legacy: MessageEnvelope['data'] = {
        id: 44,
        role: 'assistant',
        created_at: '2026-04-30T13:32:00.000Z',
    };

    assert.equal(notifiableAssistantFromEnvelope(legacy)?.id, 44);
});

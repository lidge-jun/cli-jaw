import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionIntent } from '../../src/browser/web-ai/action-intent.ts';
import { resolveTargetForIntent } from '../../src/browser/web-ai/target-resolver.ts';

function makeLocator(input: { count?: number; visible?: boolean; enabled?: boolean; editable?: boolean; role?: string; label?: string; tagName?: string }) {
    const locator = {
        async count() { return input.count ?? 1; },
        first() { return locator; },
        async isVisible() { return input.visible ?? true; },
        async isEnabled() { return input.enabled ?? true; },
        async isEditable() { return input.editable ?? true; },
        async evaluate<T>(fn: (node: any) => T): Promise<T> {
            return fn({
                getAttribute(name: string) {
                    if (name === 'role') return input.role || null;
                    if (name === 'aria-label') return input.label || '';
                    return null;
                },
                tagName: input.tagName || 'BUTTON',
                isContentEditable: input.editable ?? false,
                contentEditable: input.editable ? 'true' : 'false',
                textContent: input.label || '',
            });
        },
    };
    return locator;
}

test('action intent serializes send.click evidence requirements', () => {
    const intent = createActionIntent({ provider: 'chatgpt', intentId: 'send.click' });

    assert.equal(intent.feature, 'sendButton');
    assert.equal(intent.operation, 'click');
    assert.deepEqual(intent.requiredEvidence, ['visible', 'enabled']);
});

test('target resolver resolves ChatGPT send button through semantic fallback', async () => {
    const page = {
        url: () => 'https://chatgpt.com/',
        locator: (selector: string) => selector === 'button[data-testid="send-button"]'
            ? makeLocator({ role: 'button', label: 'Send', tagName: 'BUTTON' })
            : makeLocator({ count: 0 }),
        getByRole: () => makeLocator({ count: 0 }),
    };

    const result = await resolveTargetForIntent(page, { provider: 'chatgpt', intentId: 'send.click' });

    assert.equal(result.ok, true);
    assert.equal(result.intent.intentId, 'send.click');
    assert.equal(result.target?.selector, 'button[data-testid="send-button"]');
});

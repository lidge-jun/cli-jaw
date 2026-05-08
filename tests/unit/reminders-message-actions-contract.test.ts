import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

test('web chat exposes Pin as reminder through extracted message actions', () => {
    const ui = read('public/js/ui.ts');
    const actions = read('public/js/features/message-actions.ts');
    const item = read('public/js/features/message-item-html.ts');
    const chatMessages = read('public/js/features/chat-messages.ts');
    const css = read('public/css/chat.css');

    assert.ok(ui.includes("from './features/message-actions.js'"), 'ui.ts must delegate message actions to the extracted module');
    assert.ok(item.includes('messageSourceAttributes({ role, messageId, turnIndex: index })'), 'history messages must carry source metadata');
    assert.ok(chatMessages.includes("div.setAttribute('data-message-id', messageId)"), 'live messages must carry a generated message id');
    assert.ok(actions.includes("'/api/dashboard/reminders/from-message'"), 'pin action must call the reminders from-message endpoint');
    assert.ok(actions.includes("title: compactReminderTitle(text)"), 'pin payload must derive a readable reminder title');
    assert.ok(actions.includes("priority: 'normal'"), 'pin payload must default to normal priority');
    assert.ok(actions.includes('turnIndex: parseTurnIndex'), 'pin payload must include a typed turn index');
    assert.ok(actions.includes('options.onStatus?.(`Reminder pin failed:'), 'pin failures must surface to the user');
    assert.ok(actions.includes("title=\"Pin as reminder\""), 'message action HTML must expose the pin affordance');
    assert.ok(css.includes('.msg-pin-reminder'), 'chat CSS must style the pin reminder action');
});

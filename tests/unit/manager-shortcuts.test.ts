import assert from 'node:assert/strict';
import test from 'node:test';
import {
    actionForShortcutEvent,
    DEFAULT_MANAGER_SHORTCUT_KEYMAP,
    formatShortcut,
    shortcutMatches,
} from '../../public/manager/src/manager-shortcuts.js';

function keyEvent(key: string, modifiers: Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>> = {}): KeyboardEvent {
    return {
        key,
        altKey: modifiers.altKey === true,
        ctrlKey: modifiers.ctrlKey === true,
        metaKey: modifiers.metaKey === true,
        shiftKey: modifiers.shiftKey === true,
    } as KeyboardEvent;
}

test('manager shortcut matching requires exact modifiers and normalized keys', () => {
    assert.equal(shortcutMatches(keyEvent('i', { altKey: true }), 'Alt+I'), true);
    assert.equal(shortcutMatches(keyEvent('I', { altKey: true }), 'Alt+I'), true);
    assert.equal(shortcutMatches(keyEvent('i', { altKey: true, shiftKey: true }), 'Alt+I'), false);
    assert.equal(shortcutMatches(keyEvent('ArrowUp', { altKey: true }), 'Alt+ArrowUp'), true);
    assert.equal(shortcutMatches(keyEvent('n', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+N'), true);
});

test('manager shortcut action lookup uses the configured keymap', () => {
    assert.equal(
        actionForShortcutEvent(keyEvent('p', { altKey: true }), DEFAULT_MANAGER_SHORTCUT_KEYMAP),
        'focusActiveSession',
    );
    assert.equal(
        actionForShortcutEvent(keyEvent('j', { altKey: true }), DEFAULT_MANAGER_SHORTCUT_KEYMAP),
        'nextInstance',
    );
    assert.equal(
        actionForShortcutEvent(keyEvent('j', { ctrlKey: true }), DEFAULT_MANAGER_SHORTCUT_KEYMAP),
        null,
    );
});

test('manager shortcut labels render readable chords', () => {
    assert.equal(formatShortcut('Alt+I'), 'Alt + I');
    assert.equal(formatShortcut('Ctrl + Shift + N'), 'Ctrl + Shift + N');
});

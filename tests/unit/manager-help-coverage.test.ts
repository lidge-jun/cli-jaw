import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHelpShortcutEditableTarget } from '../../public/manager/src/help/help-shortcuts.ts';
import { resetWebUiDom, setupWebUiDom } from './web-ui-test-dom.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

test.afterEach(() => {
    resetWebUiDom();
});

test('manager help registry covers major dashboard modes and cross-cutting topics', () => {
    const src = readFileSync(join(root, 'public/manager/src/help/helpContent.tsx'), 'utf8');
    const required = [
        'instances',
        'board',
        'schedule',
        'reminders',
        'notes',
        'settings',
        'shortcuts',
        'routing',
        'processLifecycle',
        'dangerousActions',
    ];
    for (const topic of required) {
        assert.ok(src.includes(`'${topic}'`), `${topic} help topic id missing`);
        assert.ok(src.includes(`${topic}: {`) || src.includes(` ${topic}: {`), `${topic} help content missing`);
    }
});

test('manager help shortcut ignores editable targets', () => {
    setupWebUiDom();
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const button = document.createElement('button');

    assert.equal(isHelpShortcutEditableTarget(input), true);
    assert.equal(isHelpShortcutEditableTarget(textarea), true);
    assert.equal(isHelpShortcutEditableTarget(editor), true);
    assert.equal(isHelpShortcutEditableTarget(button), false);
    assert.equal(isHelpShortcutEditableTarget(null), false);
});

test('manager app wires ? key to shortcuts help topic', () => {
    const src = readFileSync(join(root, 'public/manager/src/App.tsx'), 'utf8');
    assert.ok(src.includes("event.key !== '?'"), 'App must listen for ? key');
    assert.ok(src.includes("setHelpTopic('shortcuts')"), 'App must open shortcuts help topic');
    assert.ok(src.includes('isHelpShortcutEditableTarget(event.target)'), 'App must ignore editable shortcut targets');
});

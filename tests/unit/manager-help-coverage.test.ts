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
    assert.ok(src.includes("openHelpTopic('shortcuts')"), 'App must open shortcuts help topic through the shared helper');
    assert.ok(src.includes('isHelpShortcutEditableTarget(event.target)'), 'App must ignore editable shortcut targets');
});

test('manager non-notes workspaces expose local help buttons', () => {
    const button = readFileSync(join(root, 'public/manager/src/help/HelpTopicButton.tsx'), 'utf8');
    assert.ok(button.includes('export function HelpTopicButton'), 'shared help topic button component must exist');
    assert.ok(button.includes('topic: HelpTopicId'), 'help topic button must use typed topic ids');

    const app = readFileSync(join(root, 'public/manager/src/App.tsx'), 'utf8');
    const chrome = readFileSync(join(root, 'public/manager/src/AppChrome.tsx'), 'utf8');
    const router = readFileSync(join(root, 'public/manager/src/SidebarRailRouter.tsx'), 'utf8');

    assert.ok(app.includes('const openHelpTopic'), 'App must own the open-help callback');
    assert.ok(app.includes('onOpenHelpTopic={openHelpTopic}'), 'App must pass help callback into AppChrome');
    assert.ok(chrome.includes('onOpenHelpTopic: (topic: HelpTopicId) => void'), 'AppChrome props must type the help callback');
    assert.ok(chrome.includes('onOpenHelpTopic={props.onOpenHelpTopic}'), 'AppChrome must pass help callback into SidebarRailRouter');
    assert.ok(router.includes('onOpenHelpTopic: (topic: HelpTopicId) => void'), 'SidebarRailRouter props must type the help callback');

    const workspaceTopics: Array<[string, string]> = [
        ['public/manager/src/components/WorkbenchHeader.tsx', 'topic="instances"'],
        ['public/manager/src/dashboard-board/DashboardBoardWorkspace.tsx', 'topic="board"'],
        ['public/manager/src/dashboard-schedule/DashboardScheduleWorkspace.tsx', 'topic="schedule"'],
        ['public/manager/src/dashboard-reminders/DashboardRemindersWorkspace.tsx', 'topic="reminders"'],
        ['public/manager/src/dashboard-settings/DashboardSettingsWorkspace.tsx', 'topic="settings"'],
    ];
    for (const [file, topicNeedle] of workspaceTopics) {
        const src = readFileSync(join(root, file), 'utf8');
        assert.ok(src.includes('HelpTopicButton'), `${file} must render the shared help button`);
        assert.ok(src.includes('onOpenHelpTopic'), `${file} must receive or use the help callback`);
        assert.ok(src.includes(topicNeedle), `${file} must bind ${topicNeedle}`);
    }
});

test('manager global help upgrade keeps notes implementation out of scope', () => {
    const router = readFileSync(join(root, 'public/manager/src/SidebarRailRouter.tsx'), 'utf8');
    const notesWorkspaceCall = router.match(/<NotesWorkspace[\s\S]*?\/>/)?.[0] ?? '';

    assert.equal(notesWorkspaceCall.includes('onOpenHelpTopic'), false, 'NotesWorkspace must not receive global help-upgrade wiring');
    assert.equal(notesWorkspaceCall.includes('HelpTopicButton'), false, 'NotesWorkspace must not receive a new help button in this issue');
    assert.equal(router.includes('notes/changes'), false, 'global help work must not add notes auto-switch API usage');
});

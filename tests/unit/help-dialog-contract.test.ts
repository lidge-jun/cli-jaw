import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELP_TOPICS } from '../../public/js/features/help-content.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');

const contentPath = join(root, 'public/js/features/help-content.ts');
const dialogPath = join(root, 'public/js/features/help-dialog.ts');
const mainPath = join(root, 'public/js/main.ts');
const indexPath = join(root, 'public/index.html');
const cssPath = join(root, 'public/css/modals.css');
const localePaths = ['ko', 'en', 'ja', 'zh'].map(locale => join(root, `public/locales/${locale}.json`));
const planPath = join(root, 'devlog/_plan/260425_help_dialog/plan.md');

const topicIds = Object.keys(HELP_TOPICS).sort();

function read(path: string): string {
    return readFileSync(path, 'utf8');
}

function json(path: string): Record<string, string> {
    return JSON.parse(read(path)) as Record<string, string>;
}

function uniqueMatches(source: string, pattern: RegExp): string[] {
    return [...new Set([...source.matchAll(pattern)].map(match => match[1]))].sort();
}

function findHelpButton(html: string, topicId: string): { attrs: string; body: string } {
    const escapedTopic = topicId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = html.match(new RegExp(`<button\\b([^>]*data-help-topic="${escapedTopic}"[^>]*)>([\\s\\S]*?)<\\/button>`));
    assert.ok(match, `missing help button for topic: ${topicId}`);
    return { attrs: match[1] ?? '', body: match[2] ?? '' };
}

function flattenHelpKeys(): string[] {
    const keys = new Set([
        'help.section.what',
        'help.section.effect',
        'help.section.useWhen',
        'help.section.howTo',
        'help.section.example',
        'help.section.avoidWhen',
        'help.section.related',
        'help.close',
    ]);

    for (const [id, topic] of Object.entries(HELP_TOPICS)) {
        keys.add(`help.${id}.aria`);
        keys.add(topic.titleKey);
        keys.add(topic.introKey);
        keys.add(topic.effectKey);
        for (const key of topic.useWhenKeys) keys.add(key);
        for (const key of topic.howToKeys) keys.add(key);
        for (const key of topic.exampleKeys) keys.add(key);
        for (const key of topic.avoidWhenKeys ?? []) keys.add(key);
        for (const key of topic.relatedKeys ?? []) keys.add(key);
    }

    return [...keys].sort();
}

test('HD-001: help modules exist and export the public API', () => {
    assert.ok(existsSync(contentPath), 'help-content.ts should exist');
    assert.ok(existsSync(dialogPath), 'help-dialog.ts should exist');

    const dialogSrc = read(dialogPath);
    for (const name of ['initHelpDialog', 'openHelpDialog', 'closeHelpDialog', 'isHelpDialogOpen']) {
        assert.ok(dialogSrc.includes(`export function ${name}`), `missing export: ${name}`);
    }
});

test('HD-002: app initializes help dialog after i18n and before websocket connect', () => {
    const mainSrc = read(mainPath);
    assert.ok(mainSrc.includes("import { initHelpDialog } from './features/help-dialog.js'"), 'main.ts should import initHelpDialog');

    const i18nIdx = mainSrc.indexOf('await initI18n();');
    const helpIdx = mainSrc.indexOf('initHelpDialog();');
    const connectIdx = mainSrc.indexOf('connect();');

    assert.ok(i18nIdx >= 0, 'main.ts should initialize i18n');
    assert.ok(helpIdx > i18nIdx, 'initHelpDialog() should run after initI18n()');
    assert.ok(connectIdx >= 0, 'main.ts should call connect()');
    assert.ok(helpIdx < connectIdx, 'initHelpDialog() should run before connect()');
});

test('HD-003: HTML help topics and HELP_TOPICS stay in sync', () => {
    const html = read(indexPath);
    const htmlTopics = uniqueMatches(html, /data-help-topic="([^"]+)"/g);

    assert.deepEqual(htmlTopics, topicIds, 'index.html data-help-topic values should exactly match HELP_TOPICS');
    for (const topic of ['chatInput', 'orchestration', 'attachments', 'diagrams', 'keyboardShortcuts']) {
        assert.ok(topicIds.includes(topic), `missing classic help topic: ${topic}`);
    }
});

test('HD-004: help locale keys exist in all supported web locales', () => {
    const locales = localePaths.map(path => ({ path, values: json(path) }));

    const html = read(indexPath);
    const requiredKeys = new Set([
        ...flattenHelpKeys(),
        ...uniqueMatches(html, /data-i18n-aria="([^"]+)"/g),
    ]);

    for (const { path, values } of locales) {
        for (const key of requiredKeys) {
            assert.equal(typeof values[key], 'string', `missing locale key in ${path}: ${key}`);
            assert.ok(values[key].trim(), `empty locale key in ${path}: ${key}`);
        }
    }
});

test('HD-005: help triggers do not nest inside translatable leaf nodes or buttons', () => {
    const html = read(indexPath);

    for (const match of html.matchAll(/<([a-z0-9-]+)\b[^>]*data-i18n="[^"]+"[^>]*>([\s\S]*?)<\/\1>/gi)) {
        assert.ok(!match[2].includes('help-trigger'), 'help trigger should be a sibling of data-i18n leaf text, not nested inside it');
    }

    for (const match of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)) {
        assert.ok(!match[1].includes('help-trigger'), 'help trigger button should not be nested inside another button');
    }
});

test('HD-006: adjacent chat input help triggers are visually distinct', () => {
    const html = read(indexPath);
    const chatInput = findHelpButton(html, 'chatInput');
    const keyboardShortcuts = findHelpButton(html, 'keyboardShortcuts');

    assert.equal(chatInput.body.trim(), '?', 'chat input help should stay the standard question trigger');
    assert.ok(
        keyboardShortcuts.attrs.includes('help-trigger--shortcut'),
        'keyboard shortcuts trigger should have a distinct visual variant',
    );
    assert.ok(
        keyboardShortcuts.body.includes('data-icon="key"'),
        'keyboard shortcuts trigger should render a key icon instead of another bare question mark',
    );
    assert.notEqual(
        chatInput.body.trim(),
        keyboardShortcuts.body.trim(),
        'chat input and shortcut help triggers should not render as identical adjacent buttons',
    );
});

test('HD-007: help dialog uses safe text rendering and focus-aware modal behavior', () => {
    const src = read(dialogPath);

    assert.ok(!src.includes('innerHTML'), 'help-dialog.ts should not use innerHTML');
    assert.ok(src.includes('textContent'), 'help-dialog.ts should render translated content with textContent');
    assert.ok(src.includes("t('help.section.effect')"), 'effect section should render');
    assert.ok(src.includes("t('help.section.howTo')"), 'how-to section should render');
    assert.ok(src.includes("t('help.section.example')"), 'example section should render');
    assert.ok(src.includes("setAttribute('role', 'dialog')"), 'dialog role should be set');
    assert.ok(src.includes("setAttribute('aria-modal', 'true')"), 'aria-modal should be set');
    assert.ok(src.includes("setAttribute('aria-labelledby'"), 'aria-labelledby should be set');
    assert.ok(src.includes("document.addEventListener('keydown', handleKeydownCapture, true)"), 'Escape handler should run in capture phase');
    assert.ok(src.includes('stopImmediatePropagation'), 'Escape should not leak to older global modal handlers');
    assert.ok(src.includes('lastOpener'), 'dialog should remember opener for focus return');
    assert.ok(src.includes('.focus('), 'dialog should move or restore focus');
    assert.ok(src.includes('closeHelpDialog();'), 'dismiss paths should route through closeHelpDialog()');
});

test('HD-008: help styles provide restrained desktop controls and mobile hit targets', () => {
    const css = read(cssPath);

    for (const selector of ['.label-with-help', '.section-title-row', '.help-trigger', '.help-trigger--shortcut', '.help-dialog-box', '.help-dialog-body']) {
        assert.ok(css.includes(selector), `missing CSS selector: ${selector}`);
    }

    assert.ok(css.includes('@media (max-width: 768px)'), 'mobile rules should exist');
    assert.ok(css.includes('--help-trigger-visual-size'), 'visible help trigger size should use a token');
    assert.ok(css.includes('--help-trigger-hit-size'), 'mobile hit target should use a token');
    assert.ok(css.includes('44px'), 'mobile help trigger should provide 44px hit targets');
    assert.ok(css.includes('.help-trigger::before'), 'mobile hit target should be separated from visible icon size');
    assert.ok(css.includes('backdrop-filter: none'), 'help dialog surface should disable translucent backdrop blur');
});

test('HD-009: shortcut help content names the actual supported key bindings', () => {
    const requiredTokens = [
        '?',
        '/',
        'Enter',
        'Shift+Enter',
        'Alt+I',
        'Alt+P',
        'Alt+N',
        'Alt+K',
        'Alt+J',
        'Cmd/Ctrl+S',
        'Cmd/Ctrl+E',
        'Cmd/Ctrl+Shift+F',
        'Cmd/Ctrl+P',
        'Cmd/Ctrl+Delete',
        'Cmd/Ctrl+Backspace',
    ];

    for (const path of localePaths) {
        const values = json(path);
        const text = [
            values['help.keyboardShortcuts.howTo.1'],
            values['help.keyboardShortcuts.howTo.2'],
            values['help.keyboardShortcuts.howTo.3'],
            values['help.keyboardShortcuts.example.1'],
            values['help.keyboardShortcuts.example.2'],
        ].join(' ');
        for (const token of requiredTokens) {
            assert.ok(text.includes(token), `shortcut help in ${path} should mention ${token}`);
        }
    }
});

test('HD-010: plan records audit-sensitive integration requirements', (t) => {
    if (!existsSync(planPath)) {
        t.skip('help dialog plan is stored in optional devlog submodule');
        return;
    }
    const plan = read(planPath);

    for (const text of [
        'await initI18n()',
        'leaf',
        'Escape',
        'focus',
        'innerHTML',
        'textContent',
        'data-help-topic',
    ]) {
        assert.ok(plan.includes(text), `plan should mention: ${text}`);
    }
});

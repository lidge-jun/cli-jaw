import type { DashboardShortcutAction, DashboardShortcutKeymap } from './types';

export const MANAGER_SHORTCUT_ACTIONS: DashboardShortcutAction[] = [
    'focusInstances',
    'focusActiveSession',
    'focusNotes',
    'previousInstance',
    'nextInstance',
];

export const DEFAULT_MANAGER_SHORTCUT_KEYMAP: DashboardShortcutKeymap = {
    focusInstances: 'Alt+I',
    focusActiveSession: 'Alt+P',
    focusNotes: 'Alt+N',
    previousInstance: 'Alt+K',
    nextInstance: 'Alt+J',
};

type ParsedShortcut = {
    key: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
};

function normalizeKey(value: string): string {
    const lower = value.trim().toLowerCase();
    if (!lower) return '';
    if (lower === 'space') return ' ';
    if (lower.length === 1) return lower;
    if (lower === 'arrowup') return 'arrowup';
    if (lower === 'arrowdown') return 'arrowdown';
    if (lower === 'arrowleft') return 'arrowleft';
    if (lower === 'arrowright') return 'arrowright';
    return lower;
}

function parseShortcut(raw: string): ParsedShortcut | null {
    const parts = raw.split('+').map(part => part.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    const parsed: ParsedShortcut = {
        key: '',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
    };
    for (const part of parts) {
        const lower = part.toLowerCase();
        if (lower === 'alt' || lower === 'option') parsed.altKey = true;
        else if (lower === 'ctrl' || lower === 'control') parsed.ctrlKey = true;
        else if (lower === 'meta' || lower === 'cmd' || lower === 'command') parsed.metaKey = true;
        else if (lower === 'shift') parsed.shiftKey = true;
        else parsed.key = normalizeKey(part);
    }
    return parsed.key ? parsed : null;
}

export function shortcutMatches(event: KeyboardEvent, raw: string): boolean {
    const parsed = parseShortcut(raw);
    if (!parsed) return false;
    return event.altKey === parsed.altKey
        && event.ctrlKey === parsed.ctrlKey
        && event.metaKey === parsed.metaKey
        && event.shiftKey === parsed.shiftKey
        && normalizeKey(event.key) === parsed.key;
}

export function actionForShortcutEvent(
    event: KeyboardEvent,
    keymap: DashboardShortcutKeymap,
): DashboardShortcutAction | null {
    for (const action of MANAGER_SHORTCUT_ACTIONS) {
        if (shortcutMatches(event, keymap[action])) return action;
    }
    return null;
}

export function formatShortcut(raw: string): string {
    return raw
        .split('+')
        .map(part => part.trim())
        .filter(Boolean)
        .join(' + ');
}

export function isManagerShortcutEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return Boolean(target.closest('[contenteditable="true"], .cm-editor, .ProseMirror, [data-milkdown-root]'));
}

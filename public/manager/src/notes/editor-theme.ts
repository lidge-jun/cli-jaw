import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

export const notesEditorTheme = EditorView.theme({
    '&': {
        height: '100%',
        color: 'var(--text-primary)',
        backgroundColor: 'var(--canvas-deep)',
    },
    '.cm-editor': {
        height: '100%',
        color: 'var(--text-primary)',
        backgroundColor: 'var(--canvas-deep)',
    },
    '.cm-scroller': {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        backgroundColor: 'var(--canvas-deep)',
    },
    '.cm-content': {
        caretColor: 'var(--text-primary)',
    },
    '.cm-gutters': {
        color: 'var(--text-tertiary, var(--text-secondary))',
        backgroundColor: 'var(--canvas-deep)',
        borderRight: '1px solid var(--border-subtle)',
    },
    '.cm-activeLine': {
        backgroundColor: 'var(--canvas-soft)',
    },
    '.cm-activeLineGutter': {
        color: 'var(--text-primary)',
        backgroundColor: 'var(--canvas-soft)',
    },
    '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--text-primary)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--accent-soft)',
    },
    '&.cm-focused': {
        outline: '1px solid var(--border-strong)',
    },
    '.cm-line': {
        color: 'var(--text-primary)',
    },
    '.cm-panels': {
        color: 'var(--text-primary)',
        backgroundColor: 'var(--bg-panel)',
        borderColor: 'var(--border-subtle)',
    },
    '.cm-tooltip': {
        color: 'var(--text-primary)',
        backgroundColor: 'var(--bg-panel)',
        border: '1px solid var(--border-subtle)',
    },
    '.cm-matchingBracket, .cm-nonmatchingBracket': {
        outline: '1px solid var(--accent)',
        backgroundColor: 'var(--accent-soft)',
    },
}, { dark: true });

const notesHighlightStyle = HighlightStyle.define([
    { tag: tags.heading, color: 'var(--text-primary)', fontWeight: '650' },
    { tag: [tags.strong, tags.emphasis], color: 'var(--text-primary)' },
    { tag: tags.link, color: 'var(--accent-strong, var(--accent))', textDecoration: 'underline' },
    { tag: tags.url, color: 'var(--accent-strong, var(--accent))' },
    { tag: [tags.keyword, tags.atom, tags.bool], color: 'var(--accent-strong, var(--accent))' },
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--success-strong, var(--text-primary))' },
    { tag: [tags.comment, tags.quote], color: 'var(--text-tertiary, var(--text-secondary))' },
    { tag: [tags.number, tags.integer, tags.float], color: 'var(--warning-strong, var(--text-primary))' },
    { tag: [tags.variableName, tags.propertyName], color: 'var(--text-primary)' },
    { tag: [tags.definition(tags.variableName), tags.function(tags.variableName)], color: 'var(--accent)' },
    { tag: [tags.punctuation, tags.bracket], color: 'var(--text-secondary)' },
    { tag: tags.invalid, color: 'var(--danger-strong, var(--text-primary))' },
]);

export const notesSyntaxHighlighting = syntaxHighlighting(notesHighlightStyle);

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeWysiwygAdapter } from './helpers/FakeWysiwygAdapter';

const themeTokens = {
    colorText: '#111',
    colorMuted: '#666',
    colorCanvas: '#fff',
    colorCanvasSoft: '#f6f6f6',
    colorBorder: '#ddd',
    colorAccent: '#2563eb',
    colorDanger: '#dc2626',
    fontBody: 'sans-serif',
    fontMono: 'monospace',
};

test('WYSIWYG adapter contract is dependency-neutral and lifecycle-safe', () => {
    const adapter = new FakeWysiwygAdapter();
    const container = { nodeType: 1 } as HTMLElement;
    const changes: string[] = [];
    const unsubscribe = adapter.onMarkdownChange(change => changes.push(`${change.origin}:${change.markdown}`));

    adapter.mount(container);
    adapter.focus();
    adapter.setActive(true);
    adapter.setReadOnly(true);
    adapter.setTheme(themeTokens);
    adapter.setPastePolicy({ handlePaste: input => ({ kind: 'insert-text', text: input.textPlain ?? '' }) });
    adapter.setMarkdown('# Initial', { emitChange: false });
    adapter.simulateUserEdit('# Edited');
    adapter.setMarkdown('# Synced', { emitChange: true, preserveUndo: true });

    assert.equal(adapter.mounted, true);
    assert.equal(adapter.focused, true);
    assert.equal(adapter.active, true);
    assert.equal(adapter.readOnly, true);
    assert.deepEqual(adapter.theme, themeTokens);
    assert.equal(adapter.getMarkdown(), '# Synced');
    assert.deepEqual(changes, ['user:# Edited', 'set-markdown:# Synced']);

    unsubscribe();
    adapter.simulateUserEdit('# No listener');
    assert.deepEqual(changes, ['user:# Edited', 'set-markdown:# Synced']);
    adapter.destroy();
    assert.equal(adapter.mounted, false);
});

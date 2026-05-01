import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultWysiwygPastePolicy } from '../../public/manager/src/notes/wysiwyg/wysiwyg-paste-policy';

function installDocumentStub(): void {
    globalThis.document = {
        createElement: () => ({
            innerHTML: '',
            get content() {
                const text = this.innerHTML
                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, '');
                return { textContent: text };
            },
        }),
    } as unknown as Document;
}

test('default WYSIWYG paste policy prefers plain text over HTML', () => {
    installDocumentStub();
    const result = defaultWysiwygPastePolicy.handlePaste({
        textPlain: 'plain **markdown**',
        textHtml: '<strong>html</strong>',
    });

    assert.deepEqual(result, { kind: 'insert-text', text: 'plain **markdown**' });
});

test('default WYSIWYG paste policy downgrades HTML-only paste to inert text', () => {
    installDocumentStub();
    const result = defaultWysiwygPastePolicy.handlePaste({
        textPlain: null,
        textHtml: '<img src=x onerror=alert(1)>pasted text',
    });

    assert.deepEqual(result, { kind: 'insert-text', text: 'pasted text' });
});

test('default WYSIWYG paste policy makes javascript URLs inert', () => {
    installDocumentStub();
    const result = defaultWysiwygPastePolicy.handlePaste({
        textPlain: '[bad](javascript:alert(1))',
        textHtml: '<a href="javascript:alert(1)">bad</a>',
    });

    assert.deepEqual(result, { kind: 'insert-text', text: '[bad](blocked:alert(1))' });
});

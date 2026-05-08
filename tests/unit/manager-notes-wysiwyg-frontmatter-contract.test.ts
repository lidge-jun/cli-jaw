import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    composeWysiwygFrontmatter,
    splitWysiwygFrontmatter,
    updateWysiwygFrontmatter,
} from '../../public/manager/src/notes/wysiwyg/wysiwyg-frontmatter';

test('WYSIWYG frontmatter edits preserve unknown YAML keys', () => {
    const doc = splitWysiwygFrontmatter('---\ntitle: Alpha\nstatus: active\ntags: old\n---\n# Body\n');
    const next = updateWysiwygFrontmatter(doc.frontmatter, { tags: ['new'] });
    const recomposed = composeWysiwygFrontmatter(next, doc.body);

    assert.match(recomposed, /title: Alpha/);
    assert.match(recomposed, /status: active/);
    assert.match(recomposed, /tags:/);
    assert.match(recomposed, /- new/);
    assert.match(recomposed, /# Body/);
});

test('WYSIWYG frontmatter normalizes alias and hash tags like the vault index', () => {
    const doc = splitWysiwygFrontmatter('---\nalias: One\ntags: "#work #active"\n---\nBody\n');

    assert.deepEqual(doc.frontmatter?.aliases, ['One']);
    assert.deepEqual(doc.frontmatter?.tags, ['work', 'active']);
});

test('WYSIWYG frontmatter preserves invalid YAML as non-editable raw metadata', () => {
    const doc = splitWysiwygFrontmatter('---\ntags: [unterminated\n---\nBody\n');
    const next = updateWysiwygFrontmatter(doc.frontmatter, { tags: ['new'] });

    assert.equal(doc.frontmatter?.editable, false);
    assert.match(doc.frontmatter?.error ?? '', /flow|sequence|collection|end/i);
    assert.equal(next?.raw, doc.frontmatter?.raw);
    assert.equal(composeWysiwygFrontmatter(next, doc.body), `${doc.frontmatter?.raw}${doc.body}`);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    composeWysiwygFrontmatter,
    createEmptyWysiwygFrontmatter,
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

test('WYSIWYG can create editable frontmatter from the empty properties bar', () => {
    const created = createEmptyWysiwygFrontmatter(new Date(2026, 4, 11, 9, 30, 0));
    const tagged = updateWysiwygFrontmatter(created, { tags: ['work'], aliases: ['Alpha'] });
    const recomposed = composeWysiwygFrontmatter(tagged, '# Body\n');

    assert.equal(created.editable, true);
    assert.equal(created.created, '2026-05-11');
    assert.match(recomposed, /^---\n/);
    assert.match(recomposed, /created: 2026-05-11/);
    assert.match(recomposed, /aliases:/);
    assert.match(recomposed, /- Alpha/);
    assert.match(recomposed, /tags:/);
    assert.match(recomposed, /- work/);
    assert.match(recomposed, /# Body/);
});

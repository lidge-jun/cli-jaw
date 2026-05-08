import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { normalizeMarkdownForRoundTrip } from '../../public/manager/src/notes/wysiwyg/markdown-roundtrip';
import { REQUIRED_WYSIWYG_FIXTURES } from '../../public/manager/src/notes/wysiwyg/wysiwyg-fixtures';

const projectRoot = join(import.meta.dirname, '..', '..');

test('required WYSIWYG fixtures exist and normalize idempotently', () => {
    assert.equal(REQUIRED_WYSIWYG_FIXTURES.length, 27);
    for (const fixture of REQUIRED_WYSIWYG_FIXTURES) {
        const inputPath = join(projectRoot, fixture.inputPath);
        const expectedPath = join(projectRoot, fixture.expectedPath);
        assert.equal(existsSync(inputPath), true, `${fixture.inputPath} must exist`);
        assert.equal(existsSync(expectedPath), true, `${fixture.expectedPath} must exist`);

        const expected = readFileSync(expectedPath, 'utf8');
        const normalized = normalizeMarkdownForRoundTrip(expected);
        assert.equal(normalizeMarkdownForRoundTrip(normalized), normalized, `${fixture.id} expected output must normalize idempotently`);
    }
});

test('fixture metadata marks security, paste, conflict, IME, and large-note cases', () => {
    const byId = new Map(REQUIRED_WYSIWYG_FIXTURES.map(fixture => [fixture.id, fixture]));

    assert.equal(byId.get('links-unsafe')?.securityCase, true);
    assert.equal(byId.get('images-unsafe')?.expectedUnsafeContentInert, true);
    assert.equal(byId.get('raw-html')?.securityCase, true);
    assert.equal(byId.get('paste-html-img-onerror')?.pasteCase, true);
    assert.equal(byId.get('paste-html-javascript-link')?.pasteCase, true);
    assert.equal(byId.get('large-note-many-blocks')?.largeNoteCase, true);
    assert.equal(byId.get('conflict-local-remote')?.conflictCase, true);
    assert.equal(byId.get('ime-korean-japanese')?.imeCase, true);
    assert.equal(byId.has('wikilinks-live-preview'), true);
    assert.equal(byId.has('frontmatter-wysiwyg-panel'), true);
});

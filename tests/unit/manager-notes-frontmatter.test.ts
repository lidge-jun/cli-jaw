import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFrontmatter, parseLeadingFrontmatter } from '../../src/manager/notes/frontmatter.js';

test('notes frontmatter parses YAML lists, aliases, tags, and title', () => {
    const source = [
        '---',
        'title: Project Alpha',
        'aliases:',
        '  - Alpha',
        'alias: A',
        'tags: "#work #active"',
        'created: "2026-05-05"',
        '---',
        'Body',
    ].join('\n');
    const parsed = parseLeadingFrontmatter(source);
    const normalized = normalizeFrontmatter('alpha.md', parsed.data);

    assert.equal(parsed.error, undefined);
    assert.equal(parsed.bodyStartOffset, source.indexOf('Body'));
    assert.equal(normalized.title, 'Project Alpha');
    assert.deepEqual(normalized.aliases, ['Alpha', 'A']);
    assert.deepEqual(normalized.tags, ['work', 'active']);
    assert.equal(normalized.created, '2026-05-05');
    assert.deepEqual(normalized.warnings, []);
});

test('notes frontmatter falls back cleanly for missing and malformed YAML', () => {
    assert.deepEqual(parseLeadingFrontmatter('# No frontmatter'), { data: {}, bodyStartOffset: 0 });

    const parsed = parseLeadingFrontmatter(['---', 'tags: [unterminated', '---', 'Body'].join('\n'));
    assert.deepEqual(parsed.data, {});
    assert.equal(typeof parsed.error, 'string');
});

test('notes frontmatter warns on unsupported tag and alias values', () => {
    const normalized = normalizeFrontmatter('bad.md', {
        aliases: [{ nested: true }],
        tags: { bad: true },
    });

    assert.deepEqual(normalized.aliases, []);
    assert.deepEqual(normalized.tags, []);
    assert.deepEqual(normalized.warnings.map(warning => warning.code), [
        'frontmatter_unsupported_value',
        'frontmatter_unsupported_value',
    ]);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const projectRoot = join(import.meta.dirname, '..', '..');
const forbiddenPackages = [
    '@milkdown/',
    '@mdxeditor/editor',
    '@tiptap/',
    'lexical',
    '@lexical/',
    'remirror',
    '@remirror/',
    'blocknote',
    '@blocknote/',
    '@milkdown/crepe',
];

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

test('23.0 does not add true-WYSIWYG editor dependencies', () => {
    const packageJson = read('package.json');
    const packageLock = read('package-lock.json');
    for (const forbidden of forbiddenPackages) {
        assert.equal(packageJson.includes(forbidden), false, `package.json must not include ${forbidden}`);
        assert.equal(packageLock.includes(forbidden), false, `package-lock.json must not include ${forbidden}`);
    }
});

test('23.0 WYSIWYG source does not import editor dependencies', () => {
    const files = [
        'public/manager/src/notes/wysiwyg/wysiwyg-adapter-types.ts',
        'public/manager/src/notes/wysiwyg/markdown-roundtrip.ts',
        'public/manager/src/notes/wysiwyg/wysiwyg-fixtures.ts',
        'public/manager/src/notes/wysiwyg/wysiwyg-paste-policy.ts',
        'public/manager/src/notes/wysiwyg/wysiwyg-renderer-boundary.ts',
    ].map(read).join('\n');

    for (const forbidden of forbiddenPackages) {
        assert.equal(files.includes(forbidden), false, `WYSIWYG contracts must not import ${forbidden}`);
    }
});

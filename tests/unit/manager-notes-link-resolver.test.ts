import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWikiLinks } from '../../src/manager/notes/link-resolver.js';
import type { NoteLinkRef, NoteMetadata } from '../../src/manager/types.js';

function note(path: string, aliases: string[] = []): NoteMetadata {
    return {
        path,
        title: path,
        aliases,
        tags: [],
        mtimeMs: 1,
        size: 1,
        revision: path,
    };
}

function ref(target: string): NoteLinkRef {
    return {
        sourcePath: 'source.md',
        raw: `[[${target}]]`,
        target,
        line: 1,
        column: 1,
        startOffset: 0,
        endOffset: target.length + 4,
        status: 'missing',
        reason: 'not_found',
    };
}

test('notes resolver resolves exact paths, aliases, stems, missing, ambiguous, and invalid targets', () => {
    const notes = [
        note('folder/beta.md', ['Beta']),
        note('other/solo.md'),
        note('a/dup.md'),
        note('b/dup.md'),
    ];
    const resolved = resolveWikiLinks([
        ref('folder/beta.md'),
        ref('folder/beta'),
        ref('Beta'),
        ref('solo'),
        ref('dup'),
        ref('missing'),
        ref('../secret'),
        ref('folder/solo'),
    ], notes);

    assert.equal(resolved[0].status, 'resolved');
    assert.equal(resolved[0].resolvedPath, 'folder/beta.md');
    assert.equal(resolved[1].resolvedPath, 'folder/beta.md');
    assert.equal(resolved[2].resolvedPath, 'folder/beta.md');
    assert.equal(resolved[3].resolvedPath, 'other/solo.md');
    assert.equal(resolved[4].status, 'ambiguous');
    assert.deepEqual(resolved[4].candidatePaths, ['a/dup.md', 'b/dup.md']);
    assert.equal(resolved[5].status, 'missing');
    assert.equal(resolved[5].reason, 'not_found');
    assert.equal(resolved[6].status, 'missing');
    assert.equal(resolved[6].reason, 'invalid_target');
    assert.equal(resolved[7].status, 'missing', 'path-like targets must not use basename fallback');
});

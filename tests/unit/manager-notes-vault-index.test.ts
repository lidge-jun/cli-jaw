import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { NotesVaultIndex } from '../../src/manager/notes/vault-index.js';

function tmpRoot(): string {
    return mkdtempSync(join(tmpdir(), 'jaw-notes-index-test-'));
}

test('notes vault index builds metadata, resolved/unresolved links, backlinks, and graph from one snapshot', async (t) => {
    const root = tmpRoot();
    const outside = tmpRoot();
    t.after(() => {
        rmSync(root, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
    });

    mkdirSync(join(root, 'a'), { recursive: true });
    mkdirSync(join(root, 'b'), { recursive: true });
    mkdirSync(join(root, '.assets'), { recursive: true });
    mkdirSync(join(root, '_templates'), { recursive: true });
    writeFileSync(join(root, 'alpha.md'), [
        '---',
        'title: Alpha Note',
        'aliases: [Start]',
        'tags:',
        '  - "#work"',
        '---',
        'See [[Beta]] [[missing]] [[dup]] [[../secret]].',
        '`[[ignored]]`',
    ].join('\n'));
    writeFileSync(join(root, 'beta.md'), ['---', 'aliases: [Beta]', '---', '# Beta'].join('\n'));
    writeFileSync(join(root, 'a', 'dup.md'), '# A');
    writeFileSync(join(root, 'b', 'dup.md'), '# B');
    writeFileSync(join(root, '.assets', 'hidden.md'), '# Hidden');
    writeFileSync(join(root, '_templates', 'template.md'), '# Template');
    writeFileSync(join(outside, 'outside.md'), '# Outside');
    symlinkSync(join(outside, 'outside.md'), join(root, 'linked.md'));

    const index = new NotesVaultIndex({ root });
    const first = await index.snapshot();

    assert.deepEqual(first.notes.map(note => note.path), ['a/dup.md', 'alpha.md', 'b/dup.md', 'beta.md']);
    const alpha = first.notes.find(note => note.path === 'alpha.md');
    assert.equal(alpha?.title, 'Alpha Note');
    assert.deepEqual(alpha?.aliases, ['Start']);
    assert.deepEqual(alpha?.tags, ['work']);

    const links = first.outgoingLinks['alpha.md'] || [];
    assert.equal(links.length, 4);
    assert.equal(links[0].status, 'resolved');
    assert.equal(links[0].resolvedPath, 'beta.md');
    assert.equal(links[1].status, 'missing');
    assert.equal(links[2].status, 'ambiguous');
    assert.deepEqual(links[2].candidatePaths, ['a/dup.md', 'b/dup.md']);
    assert.equal(links[3].reason, 'invalid_target');
    assert.equal(first.backlinks['beta.md']?.[0]?.sourcePath, 'alpha.md');
    assert.equal(first.unresolvedLinks.length, 3);
    assert.ok(first.graph.nodes.some(node => node.kind === 'missing' && node.id === 'missing:missing'));
    assert.ok(first.graph.nodes.some(node => node.kind === 'ambiguous' && node.id === 'ambiguous:dup'));
    assert.ok(first.errors.some(error => error.code === 'note_symlink_skipped' && error.path === 'linked.md'));

    writeFileSync(join(root, 'alpha.md'), 'See [[beta]].');
    const second = await index.snapshot();
    assert.ok(second.version > first.version);
    assert.equal(second.outgoingLinks['alpha.md']?.[0]?.resolvedPath, 'beta.md');
});

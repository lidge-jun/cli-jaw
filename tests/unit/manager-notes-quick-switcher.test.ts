import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterQuickSwitcherNotes } from '../../public/manager/src/notes/NotesQuickSwitcher.tsx';
import type { NoteMetadata } from '../../public/manager/src/types.ts';

function note(path: string, title: string, aliases: string[] = []): NoteMetadata {
    return {
        path,
        title,
        aliases,
        tags: [],
        mtimeMs: 0,
        size: 0,
        revision: path,
    };
}

test('quick switcher ranks title prefix above path contains', () => {
    const results = filterQuickSwitcherNotes([
        note('archive/project-alpha.md', 'Meeting notes'),
        note('daily/today.md', 'Project Alpha'),
    ], 'project');

    assert.equal(results[0]?.note.path, 'daily/today.md');
    assert.equal(results[0]?.reason, 'title');
});

test('quick switcher includes alias matches', () => {
    const results = filterQuickSwitcherNotes([
        note('notes/start.md', 'Start', ['Home base']),
        note('notes/other.md', 'Other'),
    ], 'home');

    assert.equal(results.length, 1);
    assert.equal(results[0]?.note.path, 'notes/start.md');
    assert.equal(results[0]?.reason, 'alias');
});

test('quick switcher caps results at the requested limit', () => {
    const notes = Array.from({ length: 60 }, (_, index) => note(`notes/${index}.md`, `Note ${index}`));
    const results = filterQuickSwitcherNotes(notes, 'note', 50);

    assert.equal(results.length, 50);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const projectRoot = join(import.meta.dirname, '..', '..');

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

test('23.0 does not expose WYSIWYG mode in Notes UI or registry state', () => {
    const notesTypes = read('public/manager/src/notes/notes-types.ts');
    const publicTypes = read('public/manager/src/types.ts');
    const toolbar = read('public/manager/src/notes/NotesToolbar.tsx');
    const app = read('public/manager/src/App.tsx');

    assert.ok(notesTypes.includes("export type NotesAuthoringMode = 'plain' | 'rich';"));
    assert.ok(notesTypes.includes("export type NotesViewMode = 'raw' | 'split' | 'preview' | 'settings';"));
    assert.ok(publicTypes.includes("export type DashboardNotesAuthoringMode = 'plain' | 'rich';"));
    assert.equal(notesTypes.includes("'wysiwyg'"), false);
    assert.equal(toolbar.includes('WYSIWYG'), false);
    assert.equal(app.includes("notesAuthoringMode: 'wysiwyg'"), false);
});

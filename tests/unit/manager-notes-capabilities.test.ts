import test from 'node:test';
import assert from 'node:assert/strict';
import { detectNotesCapabilities } from '../../src/manager/notes/capabilities.js';

test('notes capabilities expose stable optional tool contracts', async () => {
    const capabilities = await detectNotesCapabilities();

    assert.equal(typeof capabilities.ripgrep.available, 'boolean');
    assert.equal(capabilities.ripgrep.command, 'rg');
    assert.equal(typeof capabilities.git.available, 'boolean');
    assert.equal(capabilities.git.command, 'git');
    assert.equal(capabilities.fileWatching.available, true);
    assert.equal(capabilities.fileWatching.provider, 'fs.watch');
    assert.equal(typeof capabilities.pdf.available, 'boolean');
    assert.equal(capabilities.pdf.command, 'pdftotext');
});

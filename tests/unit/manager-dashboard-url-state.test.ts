import assert from 'node:assert/strict';
import test from 'node:test';

import { readInitialSidebarMode } from '../../public/manager/src/dashboard-url-state.ts';

test('readInitialSidebarMode accepts supported sidebar modes', () => {
    assert.equal(readInitialSidebarMode('?sidebar=reminders'), 'reminders');
    assert.equal(readInitialSidebarMode('?tray=1&sidebar=board'), 'board');
});

test('readInitialSidebarMode rejects missing or unknown sidebar modes', () => {
    assert.equal(readInitialSidebarMode(''), null);
    assert.equal(readInitialSidebarMode('?sidebar=unknown'), null);
    assert.equal(readInitialSidebarMode('?sidebar='), null);
});

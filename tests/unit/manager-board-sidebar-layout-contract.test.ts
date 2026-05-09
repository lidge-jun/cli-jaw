import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

test('board sidebar running instances list is a bounded scroll region', () => {
    const cssPath = 'public/manager/src/manager-dashboard-board-sidebar-scroll.css';
    const css = read(cssPath);
    const main = read('public/manager/src/main.tsx');
    const sidebar = read('public/manager/src/dashboard-board/DashboardBoardSidebar.tsx');

    assert.equal(existsSync(join(projectRoot, cssPath)), true, 'board sidebar scroll CSS must exist');
    assert.match(css, /\.dashboard-board-sidebar\s*\{[^}]*min-height:\s*0/s, 'sidebar must allow child overflow containment');
    assert.match(css, /\.dashboard-board-sidebar\s*\{[^}]*overflow:\s*hidden/s, 'sidebar must not leak overflow');
    assert.match(css, /\.dashboard-board-sidebar-running-list\s*\{[^}]*max-height:/s, 'running list must be vertically bounded');
    assert.match(css, /\.dashboard-board-sidebar-running-list\s*\{[^}]*overflow-y:\s*auto/s, 'running list must scroll internally');
    assert.match(css, /\.dashboard-board-sidebar-running \.dashboard-board-running-chip\s*\{[^}]*min-height:\s*52px/s, 'sidebar chip must reserve two text rows');
    assert.match(css, /\.dashboard-board-sidebar-running \.dashboard-board-running-chip-state\s*\{[^}]*grid-column:\s*3/s, 'state badge must stay in a fixed right column');
    assert.match(css, /\.dashboard-board-sidebar-running \.dashboard-board-running-chip-activity\s*\{[^}]*grid-row:\s*2/s, 'activity text must occupy its own row');
    assert.ok(main.includes('./manager-dashboard-board-sidebar-scroll.css'), 'manager entry must load board sidebar scroll CSS');
    assert.ok(sidebar.includes('aria-label={chip.activity'), 'sidebar running chip must expose full text accessibly');
    assert.equal(sidebar.includes('title={chip.activity'), false, 'sidebar running chip must not use native title tooltip');
});

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

test('dashboard reminders exposes Tauri-parity detail and matrix movement surfaces', () => {
    const workspace = read('public/manager/src/dashboard-reminders/DashboardRemindersWorkspace.tsx');
    const main = read('public/manager/src/main.tsx');

    assert.equal(existsSync(join(projectRoot, 'public/manager/src/dashboard-reminders/ReminderDetailPopover.tsx')), true);
    assert.equal(existsSync(join(projectRoot, 'public/manager/src/dashboard-reminders/useDashboardReminderDrag.ts')), true);
    assert.equal(existsSync(join(projectRoot, 'public/manager/src/manager-dashboard-reminders-parity.css')), true);

    assert.ok(workspace.includes('ReminderDetailPopover'), 'workspace must render the detail popover');
    assert.ok(workspace.includes('className="dashboard-reminders-row-more"'), 'row more control must remain present');
    assert.ok(workspace.includes('aria-label="Open reminder details"'), 'row more control must be accessible');
    assert.ok(workspace.includes('useDashboardReminderDrag'), 'workspace must wire drag hook');
    assert.ok(workspace.includes('matrixBucketToPatch'), 'workspace must patch matrix bucket moves');
    assert.ok(workspace.includes('rankTopPriorityItems(props.feed.items'), 'top priority must rank from full feed');
    assert.doesNotMatch(workspace, /function resolveMatrixBucket/, 'workspace must not keep duplicate bucket resolver');
    assert.ok(main.includes('./manager-dashboard-reminders-parity.css'), 'manager entry must load parity CSS');
});

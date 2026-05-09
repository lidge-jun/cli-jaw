import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

function read(path: string): string {
    return readFileSync(join(projectRoot, path), 'utf8');
}

test('manager frontend exposes Reminders as a gated SidebarRail workspace', () => {
    const types = read('public/manager/src/types.ts');
    const features = read('public/manager/src/dashboard-features.ts');
    const rail = read('public/manager/src/components/SidebarRail.tsx');
    const router = read('public/manager/src/SidebarRailRouter.tsx');
    const app = read('public/manager/src/App.tsx');
    const urlState = read('public/manager/src/dashboard-url-state.ts');
    const main = read('public/manager/src/main.tsx');

    assert.ok(types.includes("'reminders'"), 'DashboardSidebarMode must include reminders');
    assert.ok(features.includes('REMINDERS_WORKSPACE_ENABLED = true'), 'Reminders workspace must always be available in SidebarRail');
    assert.doesNotMatch(features, /NPM_HIDDEN_WORKSPACE_MODES[^\n]+reminders/, 'Reminders must not be hidden behind the npm workspace gate');
    assert.ok(rail.includes('remindersWorkspaceEnabled'), 'SidebarRail must receive the reminders feature gate');
    assert.ok(rail.includes("onModeChange('reminders')"), 'SidebarRail must switch to reminders mode');
    assert.ok(rail.includes('aria-label="Reminders"'), 'SidebarRail must expose an accessible Reminders button');
    assert.ok(router.includes('<DashboardRemindersSidebar'), 'router must render the reminders sidebar');
    assert.ok(router.includes('<DashboardRemindersWorkspace'), 'router must render the reminders workspace');
    assert.ok(app.includes('<SidebarRailRouter'), 'App must delegate workspace routing out of the root shell');
    assert.ok(app.includes('readInitialSidebarMode(window.location.search)'), 'App must allow sidebar URL entry');
    assert.ok(urlState.includes("'reminders'"), 'URL sidebar parser must allow reminders');
    assert.ok(main.includes('./manager-dashboard-reminders.css'), 'Reminders CSS must be loaded by the manager entry');
});

test('manager reminders frontend files and App line budget stay in bounds', () => {
    const app = read('public/manager/src/App.tsx');
    const required = [
        'public/manager/src/dashboard-reminders/reminders-api.ts',
        'public/manager/src/dashboard-reminders/useRemindersFeed.ts',
        'public/manager/src/dashboard-reminders/DashboardRemindersSidebar.tsx',
        'public/manager/src/dashboard-reminders/DashboardRemindersWorkspace.tsx',
        'public/manager/src/manager-dashboard-reminders.css',
    ];
    for (const path of required) {
        assert.equal(existsSync(join(projectRoot, path)), true, `${path} must exist`);
    }
    assert.ok(app.split('\n').length <= 500, 'App.tsx must stay under the 500-line dashboard budget');
});

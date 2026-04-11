// ─── Employee Management ─────────────────────────────
// Shared employee seeding logic for web, telegram, discord contexts.

import crypto from 'node:crypto';
import { getEmployees, deleteEmployee, insertEmployee } from './db.js';
import { settings } from './config.js';
import { broadcast } from './bus.js';
import { getDefaultClaudeModel } from '../cli/claude-models.js';
import { regenerateB } from '../prompt/builder.js';

export const DEFAULT_EMPLOYEES = [
    { name: 'Frontend', role: 'UI/UX, CSS, components' },
    { name: 'Backend', role: 'API, DB, server logic' },
    { name: 'Research', role: 'Search, codebase exploration, uncertainty reduction, read-only reports' },
    { name: 'Docs', role: 'Documentation, README, API docs' },
];

export function seedDefaultEmployees({ reset = false, notify = false } = {}) {
    const existing = getEmployees.all();
    if (reset) {
        for (const emp of existing) deleteEmployee.run((emp as any).id);
    } else if (existing.length > 0) {
        return { seeded: 0, cli: settings.cli, skipped: true };
    }

    const cli = settings.cli;
    const defaultModel = cli === 'claude' ? getDefaultClaudeModel() : 'default';
    for (const emp of DEFAULT_EMPLOYEES) {
        insertEmployee.run(crypto.randomUUID(), emp.name, cli, defaultModel, emp.role);
    }
    if (notify) broadcast('agent_updated', {});
    regenerateB();
    return { seeded: DEFAULT_EMPLOYEES.length, cli, skipped: false };
}

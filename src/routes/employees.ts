import type { Express } from 'express';
import type { AuthMiddleware } from './types.js';
import crypto from 'crypto';
import { ok } from '../http/response.js';
import { broadcast } from '../core/bus.js';
import { db, getEmployees, insertEmployee, deleteEmployee } from '../core/db.js';
import { regenerateB } from '../prompt/builder.js';
import { getDefaultClaudeModel } from '../cli/claude-models.js';
import { seedDefaultEmployees } from '../core/employees.js';

export function registerEmployeeRoutes(app: Express, requireAuth: AuthMiddleware): void {
    app.get('/api/employees', (_, res) => ok(res, getEmployees.all()));

    app.post('/api/employees', requireAuth, (req, res) => {
        const id = crypto.randomUUID();
        const { name = 'New Agent', cli = 'claude', model = 'default', role = '' } = req.body || {};
        const nextModel = cli === 'claude' && (!model || model === 'default')
            ? getDefaultClaudeModel()
            : model;
        insertEmployee.run(id, name, cli, nextModel, role);
        const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as Record<string, any>;
        broadcast('agent_added', emp);
        regenerateB();
        res.json(emp);
    });

    app.put('/api/employees/:id', requireAuth, (req, res) => {
        const updates = req.body;
        const allowed = ['name', 'cli', 'model', 'role', 'status'];
        const sets = Object.keys(updates).filter(k => allowed.includes(k)).map(k => `${k} = ?`);
        if (sets.length === 0) return res.status(400).json({ error: 'no valid fields' });
        const vals = sets.map((_, i) => (updates as Record<string, any>)[Object.keys(updates).filter(k => allowed.includes(k))[i]!]);
        db.prepare(`UPDATE employees SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.params.id);
        const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id) as Record<string, any>;
        broadcast('agent_updated', emp);
        regenerateB();
        res.json(emp);
    });

    app.delete('/api/employees/:id', requireAuth, (req, res) => {
        deleteEmployee.run(req.params.id);
        broadcast('agent_deleted', { id: req.params.id });
        regenerateB();
        res.json({ ok: true });
    });

    // Employee reset — delete all + re-seed 5 defaults
    app.post('/api/employees/reset', requireAuth, (req, res) => {
        const { seeded } = seedDefaultEmployees({ reset: true, notify: true });
        res.json({ ok: true, seeded });
    });
}

import type { Express } from 'express';
import type { AuthMiddleware } from './types.js';
import { loadHeartbeatFile, saveHeartbeatFile } from '../core/config.js';
import { startHeartbeat } from '../memory/heartbeat.js';
import { validateHeartbeatScheduleInput } from '../memory/heartbeat-schedule.js';

export function registerHeartbeatRoutes(app: Express, requireAuth: AuthMiddleware): void {
    app.get('/api/heartbeat', (req, res) => res.json(loadHeartbeatFile()));

    app.put('/api/heartbeat', requireAuth, (req, res) => {
        const data = req.body;
        if (!data || !Array.isArray(data.jobs)) {
            res.status(400).json({ error: 'jobs array required' });
            return;
        }
        const normalizedJobs = [];
        const idPrefix = `hb_${Date.now()}`;
        for (const [index, rawJob] of data.jobs.entries()) {
            const job = (rawJob && typeof rawJob === 'object') ? rawJob as Record<string, unknown> : {};
            const scheduleResult = validateHeartbeatScheduleInput(job["schedule"]);
            const jobId = typeof job["id"] === 'string' && job["id"].trim()
                ? job["id"].trim()
                : `${idPrefix}_${index}`;
            if (!scheduleResult.ok) {
                res.status(400).json({
                    error: 'invalid heartbeat schedule',
                    code: scheduleResult.code,
                    detail: scheduleResult.error,
                    index,
                    jobId,
                });
                return;
            }
            normalizedJobs.push({
                id: jobId,
                name: typeof job["name"] === 'string' ? job["name"] : '',
                enabled: job["enabled"] !== false,
                schedule: scheduleResult.schedule,
                prompt: typeof job["prompt"] === 'string' ? job["prompt"] : '',
            });
        }
        const payload = { jobs: normalizedJobs };
        saveHeartbeatFile(payload);
        startHeartbeat();
        res.json(payload);
    });
}

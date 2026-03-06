// ── Heartbeat Feature ──
import { state } from '../state.js';
import type { HeartbeatJob, HeartbeatSchedule } from '../state.js';
import { t } from './i18n.js';
import { api, apiJson } from '../api.js';
import { escapeHtml } from '../render.js';

interface HeartbeatData {
    jobs: HeartbeatJob[];
}

export async function openHeartbeatModal(): Promise<void> {
    const data = await api<HeartbeatData>('/api/heartbeat');
    state.heartbeatJobs = (data?.jobs || []).map(normalizeHeartbeatJob);
    renderHeartbeatJobs();
    document.getElementById('heartbeatModal')?.classList.add('open');
}

export function closeHeartbeatModal(e?: Event): void {
    if (e && e.target !== e.currentTarget) return;
    document.getElementById('heartbeatModal')?.classList.remove('open');
}

export function renderHeartbeatJobs(): void {
    const container = document.getElementById('hbJobsList');
    if (!container) return;
    const jobs = (state.heartbeatJobs as HeartbeatJob[]).map(normalizeHeartbeatJob);
    state.heartbeatJobs = jobs;
    if (jobs.length === 0) {
        container.innerHTML = `<p style="color:var(--text-dim);font-size:12px;text-align:center">${t('hb.empty')}</p>`;
    } else {
        container.innerHTML = jobs.map((job, i) => {
            const schedule = normalizeSchedule(job.schedule);
            const isCron = schedule.kind === 'cron';
            const scheduleInput = isCron
                ? `<input type="text" value="${escapeHtml(schedule.cron)}" placeholder="${escapeHtml(t('hb.cronPlaceholder'))}"
                    data-hb-cron="${i}">`
                : `<input type="number" value="${schedule.minutes}" min="1" data-hb-minutes="${i}">`;
            const scheduleSuffix = isCron
                ? `<span class="hb-chip">${escapeHtml(t('hb.cronLabel'))}</span>`
                : `<span class="hb-chip">${escapeHtml(t('hb.minutesLabel'))}</span>`;
            return `
                <div class="hb-job-card">
                    <div class="hb-job-header">
                        <input type="text" value="${escapeHtml(String(job.name || ''))}" placeholder="${escapeHtml(t('hb.name'))}"
                            data-hb-name="${i}">
                        <button class="hb-toggle ${job.enabled ? 'on' : 'off'}"
                            data-hb-toggle="${i}"></button>
                        <button class="hb-del" data-hb-remove="${i}">✕</button>
                    </div>
                    <div class="hb-job-schedule">
                        <select data-hb-kind="${i}">
                            <option value="every"${isCron ? '' : ' selected'}>${escapeHtml(t('hb.kindEvery'))}</option>
                            <option value="cron"${isCron ? ' selected' : ''}>${escapeHtml(t('hb.kindCron'))}</option>
                        </select>
                        ${scheduleInput}
                        ${scheduleSuffix}
                        <input type="text" value="${escapeHtml(schedule.timeZone || '')}" placeholder="${escapeHtml(timeZonePlaceholder())}"
                            data-hb-timezone="${i}">
                    </div>
                    <textarea class="hb-prompt" rows="2" placeholder="${escapeHtml(t('hb.prompt'))}"
                        data-hb-prompt="${i}">${escapeHtml(String(job.prompt || ''))}</textarea>
                </div>
            `;
        }).join('');
    }
    const active = jobs.filter(j => j.enabled).length;
    const btn = document.getElementById('hbSidebarBtn');
    if (btn) btn.textContent = `💓 Heartbeat (${active})`;
}

export function addHeartbeatJob(): void {
    (state.heartbeatJobs as HeartbeatJob[]).push({
        id: 'hb_' + Date.now(),
        name: '',
        enabled: true,
        schedule: withBrowserTimeZone({ kind: 'every', minutes: 5 }),
        prompt: '',
    });
    renderHeartbeatJobs();
    void saveHeartbeatJobs();
}

export function removeHeartbeatJob(i: number): void {
    state.heartbeatJobs.splice(i, 1);
    renderHeartbeatJobs();
    void saveHeartbeatJobs();
}

export function toggleHeartbeatJob(i: number): void {
    const jobs = state.heartbeatJobs as HeartbeatJob[];
    const job = jobs[i];
    if (!job) return;
    job.enabled = !job.enabled;
    renderHeartbeatJobs();
    void saveHeartbeatJobs();
}

export async function saveHeartbeatJobs(): Promise<void> {
    const jobs = (state.heartbeatJobs as HeartbeatJob[]).map(normalizeHeartbeatJob);
    state.heartbeatJobs = jobs;
    await apiJson('/api/heartbeat', 'PUT', { jobs });
}

export async function initHeartbeatBadge(): Promise<void> {
    try {
        const d = await api<HeartbeatData>('/api/heartbeat');
        const active = (d?.jobs || []).map(normalizeHeartbeatJob).filter(j => j.enabled).length;
        const btn = document.getElementById('hbSidebarBtn');
        if (btn) btn.textContent = `💓 Heartbeat (${active})`;
    } catch { /* ignore */ }
}

function normalizeHeartbeatJob(job: HeartbeatJob): HeartbeatJob {
    return {
        id: String(job.id || `hb_${Date.now()}`),
        name: String(job.name || ''),
        enabled: job.enabled !== false,
        schedule: normalizeSchedule(job.schedule),
        prompt: String(job.prompt || ''),
    };
}

function normalizeSchedule(schedule: HeartbeatJob['schedule']): HeartbeatSchedule {
    const timeZone = normalizeTimeZone(schedule?.timeZone);
    if (schedule?.kind === 'cron') {
        const cron = typeof schedule.cron === 'string' && schedule.cron.trim()
            ? schedule.cron.trim().replace(/\s+/g, ' ')
            : '0 9 * * *';
        return timeZone ? { kind: 'cron', cron, timeZone } : { kind: 'cron', cron };
    }
    const minutes = typeof schedule?.minutes === 'number' && Number.isFinite(schedule.minutes) && schedule.minutes > 0
        ? Math.max(1, Math.floor(schedule.minutes))
        : 5;
    return timeZone ? { kind: 'every', minutes, timeZone } : { kind: 'every', minutes };
}

function normalizeTimeZone(value: unknown): string | undefined {
    const timeZone = typeof value === 'string' ? value.trim() : '';
    return timeZone || undefined;
}

function withBrowserTimeZone(schedule: HeartbeatSchedule): HeartbeatSchedule {
    const timeZone = detectBrowserTimeZone();
    if (!timeZone) return schedule;
    return { ...schedule, timeZone };
}

function detectBrowserTimeZone(): string | undefined {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch {
        return undefined;
    }
}

function timeZonePlaceholder(): string {
    const browserTimeZone = detectBrowserTimeZone();
    return browserTimeZone ? `${t('hb.timezoneAuto')} ${browserTimeZone}` : t('hb.timezoneAuto');
}

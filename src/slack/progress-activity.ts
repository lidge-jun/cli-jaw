import { createHash } from 'node:crypto';
import { projectSlackToolFile as projectFile, sanitizeSlackFileLabel as safeFileLabel } from './progress-files.js';
import { projectSlackActivityDetail, normalizeSlackActivityDetail, formatSlackActivityDetail,
    type SlackActivityDetail } from './progress-detail.js';
import { normalizeLocale, t } from '../core/i18n.js';

export type SlackActivityCategory = 'read' | 'write' | 'search' | 'web' | 'command' | 'external' | 'tool';
export type SlackProgressOutcome = 'complete' | 'error' | 'cancelled' | 'expired';
export type SlackProgressPhase = 'queued' | 'running' | 'waiting' | 'delivering' | 'unavailable';
export interface SlackActivityTool {
    key: string;
    file?: string;
    activity?: SlackActivityDetail;
    category: SlackActivityCategory;
    status: 'in_progress' | 'complete' | 'error' | 'stopped' | 'observed';
}
export interface SlackActivitySnapshot {
    title: string; workTitle: string; workStatus: 'in_progress' | 'complete' | 'error'; details: string;
    summary: string;
    activities: Array<{ title: string; status: 'in_progress' | 'complete' | 'error' }>;
    delivery?: { title: string; status: 'in_progress' | 'complete' | 'error' };
    text: string;
}

const MAX_IDENTITIES = 256;
const MAX_RECENT = 6;
const MAX_FIELD = 256;
const MAX_DETAILS = 256;
const QUIET_MS = 20_000;
// Wall clock, not idle time. Deliberately below the watchdog's 600s default so
// the card can say "this is taking a while" while the run is still perfectly
// healthy — the point is to stop a long investigation LOOKING like a hang.
const LONG_RUNNING_SECONDS = 300;
const MAX_SECONDS = 999_999_999;
const categories = new Set(['read', 'write', 'search', 'web', 'command', 'external', 'tool']);
const statuses = new Set(['in_progress', 'complete', 'error', 'stopped', 'observed']);
const phases = new Set(['queued', 'running', 'waiting', 'delivering', 'unavailable']);
const outcomes = new Set(['complete', 'error', 'cancelled', 'expired']);
const nonTools = new Set(['thinking', 'reasoning', 'narration', 'message', 'speech', 'commentary', 'final']);
const aliases = new Map<string, SlackActivityCategory>([
    ['read', 'read'], ['read_file', 'read'], ['readfile', 'read'],
    ['write', 'write'], ['write_file', 'write'], ['writefile', 'write'],
    ['edit', 'write'], ['edit_file', 'write'], ['editfile', 'write'], ['apply_patch', 'write'],
    ['grep', 'search'], ['glob', 'search'], ['list', 'search'], ['list_dir', 'search'],
    ['search', 'search'], ['websearch', 'search'], ['web_search', 'search'],
    ['webfetch', 'web'], ['web_fetch', 'web'],
    ['bash', 'command'], ['shell', 'command'], ['exec_command', 'command'],
    ['mcp', 'external'], ['external_tool', 'external'],
]);

function field(value: unknown): string {
    return typeof value === 'string' && value.length <= MAX_FIELD ? value : '';
}
function category(value: unknown): SlackActivityCategory {
    return aliases.get(field(value).trim().toLowerCase()) ?? 'tool';
}
function status(value: unknown): SlackActivityTool['status'] {
    switch (field(value).toLowerCase()) {
        case 'running': case 'in_progress': case 'started': return 'in_progress';
        case 'done': case 'complete': case 'completed': case 'success': return 'complete';
        case 'error': case 'failed': case 'rejected': return 'error';
        case 'stopped': case 'cancelled': case 'canceled': return 'stopped';
        default: return 'observed';
    }
}
function excluded(data: Record<string, unknown>): boolean {
    return ['kind', 'type', 'toolType'].some(key => nonTools.has(field(data[key]).trim().toLowerCase()))
        || ['💭', '💬', '🧠', '🗣', '🗣️'].includes(field(data['icon']).trim());
}
function digest(parts: string[]): string {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** Empty key means one uncorrelated observation, never an invented tool identity. */
export function projectSlackPrintTool(data: Record<string, unknown>, workingDir?: string): SlackActivityTool | null {
    if (!data || typeof data !== 'object' || excluded(data)) return null;
    const label = data['label'];
    const hasLabel = typeof label === 'string' && Boolean(label.slice(0, MAX_FIELD).trim());
    const hasToolType = ['kind', 'type', 'toolType'].some(key => field(data[key]).trim().toLowerCase() === 'tool');
    if (!hasLabel && !hasToolType) return null;
    const run = field(data['traceRunId']);
    const ref = field(data['stepRef']);
    const seq = data['traceSeq'];
    const step = ref ? ['ref', ref] : Number.isSafeInteger(seq) && Number(seq) >= 0 ? ['seq', String(seq)] : [];
    const agent = field(data['agentId']);
    const employee = data['isEmployee'] === true;
    const key = run && step.length && (!employee || agent)
        ? digest(['print', run, employee ? 'employee' : 'boss', agent, ...step]) : '';
    const file = projectFile(data, data['label'], workingDir, true);
    const activity = projectSlackActivityDetail(data, data['label'], workingDir, 'print');
    return { key, category: category(data['label']), status: status(data['status']), ...(file ? { file } : {}), ...(activity ? { activity } : {}) };
}

export function projectSlackRuntimeTool(data: Record<string, unknown>, workingDir?: string): SlackActivityTool | null {
    if (!data || typeof data !== 'object' || data['kind'] !== 'tool' || excluded(data)) return null;
    const parts = [field(data['runId']), field(data['turnId']), field(data['itemId'])];
    const file = projectFile(data, data['name'], workingDir);
    const activity = projectSlackActivityDetail(data, data['name'], workingDir, 'native');
    return { ...(file ? { file } : {}), ...(activity ? { activity } : {}), key: parts.every(Boolean) ? digest(['runtime', ...parts]) : '',
        category: category(data['name']), status: status(data['status']) };
}

type Row = { category: SlackActivityCategory; status: SlackActivityTool['status']; file?: string; activity?: SlackActivityDetail };
const ended = (value: SlackActivityTool['status']): boolean =>
    value === 'complete' || value === 'error' || value === 'stopped';

export function createSlackActivity(now: () => number, locale: string, initialPhase: 'queued' | 'running' = 'running', workflowResponse = false): {
    tool(entry: SlackActivityTool): boolean;
    phase(value: SlackProgressPhase): boolean;
    finish(outcome: SlackProgressOutcome, reason?: 'merged' | 'removed', bodyDelivered?: boolean): void;
    snapshot(): SlackActivitySnapshot;
} {
    const lang = normalizeLocale(locale);
    const copy = (key: string, params: Record<string, unknown> = {}): string => t(`slack.progress.${key}`, params, lang);
    let clock = 0;
    const time = (): number => {
        const value = now();
        if (Number.isFinite(value)) clock = Math.max(clock, value);
        return clock;
    };
    const createdAt = time();
    let lastActivityAt = createdAt;
    let currentPhase: SlackProgressPhase = initialPhase === 'queued' ? 'queued' : 'running';
    let terminal: SlackProgressOutcome | undefined;
    let terminalReason: 'merged' | 'removed' | undefined;
    let deliveryReceipt: boolean | undefined;
    let activityUnavailable = false;
    let finishedAt = createdAt;
    const identities = new Map<string, Row>();
    let recent: Row[] = [];
    let observation: Row | undefined;
    let observationAt = createdAt;

    return {
        tool(entry) {
            if (terminal || currentPhase === 'delivering' || !entry
                || !categories.has(entry.category) || !statuses.has(entry.status)) return false;
            // Bound even already-projected inputs at this outbound privacy boundary.
            const key = field(entry.key);
            let row = key ? identities.get(key) : undefined;
            const correlated = Boolean(key) && (Boolean(row) || identities.size < MAX_IDENTITIES);
            const file = entry.category === 'read' || entry.category === 'write' ? safeFileLabel(entry.file) : undefined;
            let activity = normalizeSlackActivityDetail(entry.activity);
            if (!correlated) row = observation?.file === file
                && JSON.stringify(observation?.activity) === JSON.stringify(activity) ? observation : undefined;
            else if (row?.activity) {
                const changedOperation = activity?.action && row.activity.action && activity.action !== row.activity.action;
                activity = normalizeSlackActivityDetail(changedOperation ? activity : { ...row.activity, ...activity });
            }
            const nextCategory = correlated ? entry.category : 'tool';
            const nextStatus = correlated ? entry.status : 'observed';
            const observedAt = time();
            if (row && (ended(row.status) || (correlated
                ? row.category === nextCategory && row.status === nextStatus && (!file || row.file === file)
                    && JSON.stringify(row.activity) === JSON.stringify(activity)
                : observedAt <= observationAt))) return false;
            if (!row) {
                row = { category: nextCategory, status: nextStatus, ...(file ? { file } : {}), ...(activity ? { activity } : {}) };
                if (correlated) identities.set(key, row);
                else observation = row;
            } else {
                row.category = nextCategory;
                row.status = nextStatus;
                if (file) row.file = file;
                if (activity) row.activity = activity;
            }
            recent = [...recent.filter(item => item !== row), row].slice(-MAX_RECENT);
            if (!correlated) observationAt = observedAt;
            lastActivityAt = observedAt;
            currentPhase = 'running';
            return true;
        },
        phase(value) {
            if (terminal || currentPhase === 'delivering' || !phases.has(value) || value === 'queued' || value === currentPhase) return false;
            if (value === 'unavailable') activityUnavailable = true;
            const beganExecution = currentPhase === 'queued' && value === 'running';
            currentPhase = value;
            if (beganExecution) lastActivityAt = time();
            return true;
        },
        finish(outcome, reason, bodyDelivered) {
            if (terminal || !outcomes.has(outcome)) return;
            terminal = outcome;
            deliveryReceipt = typeof bodyDelivered === 'boolean' ? bodyDelivered : undefined;
            terminalReason = reason === 'merged' || reason === 'removed' ? reason : undefined;
            finishedAt = time();
        },
        snapshot() {
            const at = terminal ? finishedAt : time();
            const seconds = (since: number): number => Math.min(MAX_SECONDS, Math.max(0, Math.floor((at - since) / 1000)));
            const phase = currentPhase === 'running' && at - lastActivityAt >= QUIET_MS ? 'waiting' : currentPhase;
            const description = copy(terminalReason ?? (terminal === 'complete' && workflowResponse ? 'workflowComplete' : terminal ?? phase));
            // End of observation does not manufacture a successful tool result.
            const activities: SlackActivitySnapshot['activities'] = [...recent].reverse().map(row => ({
                title: `${formatSlackActivityDetail(row.activity) || `${copy(`category.${row.category}`)}${row.file ? ` · ${row.file}` : ''}`}: ${copy(`status.${terminal && !ended(row.status) ? 'unconfirmed' : row.status}`)}`,
                // A closed observation card is not proof that its tool succeeded.
                status: row.status === 'error' ? 'error'
                    : row.status === 'in_progress' && !terminal ? 'in_progress' : 'complete',
            }));
            const elapsed = copy('elapsed', { seconds: seconds(createdAt) });
            const age = copy('lastActivity', { seconds: seconds(lastActivityAt) });
            const lines = [description, elapsed, age];
            if (activityUnavailable && (terminal || phase !== 'unavailable')) lines.push(copy('unavailable'));
            // Elapsed alone reads the same at 30s and 500s: a number the eye
            // skips. Past the threshold the card says so in words.
            //
            // An EXTRA line, never a replacement for `description`. That one is
            // the tool-activity axis — QUIET_MS flips running to waiting after
            // 20s of silence — and "taking a while" is a different axis. Both
            // can be true at once, and overwriting would hide the quiet notice
            // exactly when it matters most.
            const elapsedSeconds = seconds(createdAt);
            if (!terminal && elapsedSeconds >= LONG_RUNNING_SECONDS) {
                lines.push(copy('longRunning', { minutes: Math.floor(elapsedSeconds / 60) }));
            }
            const summary = lines.join('\n').slice(0, MAX_DETAILS);
            for (const { title: row } of activities) {
                if ([...lines, row].join('\n').length <= MAX_DETAILS) lines.push(row);
            }
            const details = lines.join('\n').slice(0, MAX_DETAILS);
            const workStatus = terminal ? (terminal === 'error' ? 'error' : 'complete') : 'in_progress';
            const delivery: SlackActivitySnapshot['delivery'] = currentPhase === 'delivering' || deliveryReceipt !== undefined
                ? { title: copy(!terminal ? 'delivering' : deliveryReceipt === true ? 'deliveryComplete'
                    : deliveryReceipt === false ? 'deliveryFailed' : 'deliveryUnconfirmed'),
                    status: !terminal ? 'in_progress' : deliveryReceipt === true ? 'complete' : 'error' } : undefined;
            const title = `${copy('title')} · ${elapsed}`;
            const workTitle = copy('activityTitle');
            // Native titles and the text fallback share the same bounded detail.
            // The compact legacy details field alone may omit a long first row.
            const text = [title, workTitle, summary, ...activities.map(row => row.title), ...(delivery ? [copy('deliveryTitle'), delivery.title] : []),
                ].join('\n');
            return { title, workTitle, workStatus, summary, activities, details, ...(delivery ? { delivery } : {}), text };
        },
    };
}

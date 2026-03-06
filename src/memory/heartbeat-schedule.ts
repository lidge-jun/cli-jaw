export interface HeartbeatEverySchedule {
    kind: 'every';
    minutes: number;
    timeZone?: string;
}

export interface HeartbeatCronSchedule {
    kind: 'cron';
    cron: string;
    timeZone?: string;
}

export type HeartbeatSchedule = HeartbeatEverySchedule | HeartbeatCronSchedule;
export type HeartbeatScheduleValidationCode =
    | 'invalid_kind'
    | 'invalid_minutes'
    | 'invalid_cron'
    | 'invalid_timezone';

export type HeartbeatScheduleValidationResult =
    | {
        ok: true;
        schedule: HeartbeatSchedule;
    }
    | {
        ok: false;
        code: HeartbeatScheduleValidationCode;
        error: string;
    };

interface CronFieldOptions {
    min: number;
    max: number;
    aliases?: Record<string, number>;
    normalize?: (value: number) => number;
}

interface ZonedDateParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    weekday: number;
}

const DEFAULT_HEARTBEAT_MINUTES = 5;
const DEFAULT_HEARTBEAT_CRON = '0 9 * * *';
const WEEKDAY_ALIASES: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
};
const MONTH_ALIASES: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
};
const WEEKDAY_NAMES: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};

export function getSystemTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

export function normalizeHeartbeatTimeZone(value: unknown): string | undefined {
    const timeZone = typeof value === 'string' ? value.trim() : '';
    if (!timeZone) return undefined;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
        return timeZone;
    } catch {
        return undefined;
    }
}

export function normalizeHeartbeatSchedule(schedule: unknown): HeartbeatSchedule {
    const raw = (schedule && typeof schedule === 'object') ? schedule as Record<string, unknown> : {};
    const timeZone = normalizeHeartbeatTimeZone(raw.timeZone);
    if (raw.kind === 'cron') {
        const cron = typeof raw.cron === 'string' && raw.cron.trim()
            ? raw.cron.trim().replace(/\s+/g, ' ')
            : DEFAULT_HEARTBEAT_CRON;
        return timeZone ? { kind: 'cron', cron, timeZone } : { kind: 'cron', cron };
    }
    const minutesValue = typeof raw.minutes === 'number' ? raw.minutes : Number(raw.minutes);
    const minutes = Number.isFinite(minutesValue) && minutesValue > 0
        ? Math.max(1, Math.floor(minutesValue))
        : DEFAULT_HEARTBEAT_MINUTES;
    return timeZone ? { kind: 'every', minutes, timeZone } : { kind: 'every', minutes };
}

export function validateHeartbeatScheduleInput(schedule: unknown): HeartbeatScheduleValidationResult {
    const raw = (schedule && typeof schedule === 'object') ? schedule as Record<string, unknown> : {};
    const rawKind = raw.kind;
    const rawTimeZone = typeof raw.timeZone === 'string' ? raw.timeZone.trim() : '';
    const timeZone = normalizeHeartbeatTimeZone(raw.timeZone);
    if (rawTimeZone && !timeZone) {
        return {
            ok: false,
            code: 'invalid_timezone',
            error: `invalid timeZone "${rawTimeZone}"`,
        };
    }

    if (rawKind === 'cron') {
        const cron = typeof raw.cron === 'string' ? raw.cron.trim().replace(/\s+/g, ' ') : '';
        if (!cron) {
            return {
                ok: false,
                code: 'invalid_cron',
                error: 'cron expression required',
            };
        }
        const cronError = validateHeartbeatCron(cron);
        if (cronError) {
            return {
                ok: false,
                code: 'invalid_cron',
                error: cronError,
            };
        }
        return {
            ok: true,
            schedule: timeZone ? { kind: 'cron', cron, timeZone } : { kind: 'cron', cron },
        };
    }

    if (rawKind == null || rawKind === 'every') {
        const minutesValue = typeof raw.minutes === 'number' ? raw.minutes : Number(raw.minutes);
        if (!Number.isInteger(minutesValue) || minutesValue < 1) {
            return {
                ok: false,
                code: 'invalid_minutes',
                error: 'minutes must be an integer >= 1',
            };
        }
        const minutes = Math.max(1, Math.floor(minutesValue));
        return {
            ok: true,
            schedule: timeZone ? { kind: 'every', minutes, timeZone } : { kind: 'every', minutes },
        };
    }

    return {
        ok: false,
        code: 'invalid_kind',
        error: `invalid heartbeat schedule kind "${String(rawKind)}"`,
    };
}

export function getHeartbeatScheduleTimeZone(schedule: unknown): string {
    return normalizeHeartbeatSchedule(schedule).timeZone || getSystemTimeZone();
}

export function describeHeartbeatSchedule(schedule: unknown): string {
    const normalized = normalizeHeartbeatSchedule(schedule);
    const tzLabel = normalized.timeZone ? normalized.timeZone : 'system';
    if (normalized.kind === 'cron') return `cron ${normalized.cron} (${tzLabel})`;
    return `every ${normalized.minutes}min (${tzLabel})`;
}

export function formatHeartbeatNow(schedule: unknown, locale: string = 'ko-KR', now: Date = new Date()): string {
    const timeZone = getHeartbeatScheduleTimeZone(schedule);
    return now.toLocaleString(locale, { timeZone, hour12: false });
}

export function getHeartbeatMinuteSlotKey(schedule: unknown, now: Date = new Date()): string {
    const timeZone = getHeartbeatScheduleTimeZone(schedule);
    const parts = getZonedDateParts(now, timeZone);
    return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)} ${timeZone}`;
}

export function validateHeartbeatCron(expression: string): string | null {
    try {
        const [minuteExpr, hourExpr, dayExpr, monthExpr, weekdayExpr] = splitCronExpression(expression);
        validateCronField(minuteExpr, { min: 0, max: 59 });
        validateCronField(hourExpr, { min: 0, max: 23 });
        validateCronField(dayExpr, { min: 1, max: 31 });
        validateCronField(monthExpr, { min: 1, max: 12, aliases: MONTH_ALIASES });
        validateCronField(weekdayExpr, {
            min: 0,
            max: 7,
            aliases: WEEKDAY_ALIASES,
            normalize: normalizeWeekday,
        });
        return null;
    } catch (err) {
        return (err as Error).message;
    }
}

export function matchesHeartbeatCron(expression: string, now: Date = new Date(), timeZone: string = getSystemTimeZone()): boolean {
    const [minuteExpr, hourExpr, dayExpr, monthExpr, weekdayExpr] = splitCronExpression(expression);
    const parts = getZonedDateParts(now, timeZone);

    if (!matchesCronField(minuteExpr, parts.minute, { min: 0, max: 59 })) return false;
    if (!matchesCronField(hourExpr, parts.hour, { min: 0, max: 23 })) return false;
    if (!matchesCronField(monthExpr, parts.month, { min: 1, max: 12, aliases: MONTH_ALIASES })) return false;

    const domWildcard = isWildcard(dayExpr);
    const dowWildcard = isWildcard(weekdayExpr);
    const domMatch = matchesCronField(dayExpr, parts.day, { min: 1, max: 31 });
    const dowMatch = matchesCronField(weekdayExpr, parts.weekday, {
        min: 0,
        max: 7,
        aliases: WEEKDAY_ALIASES,
        normalize: normalizeWeekday,
    });

    if (domWildcard && dowWildcard) return true;
    if (domWildcard) return dowMatch;
    if (dowWildcard) return domMatch;
    return domMatch || dowMatch;
}

export function startHeartbeatCronLoop(runCurrent: () => void, scheduleNext: (tick: () => void) => void): () => void {
    const tick = () => {
        try {
            runCurrent();
        } finally {
            scheduleNext(tick);
        }
    };
    try {
        runCurrent();
    } finally {
        scheduleNext(tick);
    }
    return tick;
}

function getZonedDateParts(now: Date, timeZone: string): ZonedDateParts {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        weekday: 'short',
    });
    const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
    for (const part of formatter.formatToParts(now)) {
        if (part.type === 'literal') continue;
        values[part.type] = part.value;
    }
    const weekday = WEEKDAY_NAMES[values.weekday || ''];
    if (
        !values.year
        || !values.month
        || !values.day
        || !values.hour
        || !values.minute
        || weekday == null
    ) {
        throw new Error(`failed to resolve date parts for timezone "${timeZone}"`);
    }
    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        hour: Number(values.hour),
        minute: Number(values.minute),
        weekday,
    };
}

function splitCronExpression(expression: string): [string, string, string, string, string] {
    const normalized = String(expression || '').trim().replace(/\s+/g, ' ');
    const parts = normalized.split(' ');
    if (parts.length !== 5) {
        throw new Error(`cron must have 5 fields, got ${parts.length}`);
    }
    return parts as [string, string, string, string, string];
}

function isWildcard(expression: string): boolean {
    return expression.trim() === '*';
}

function matchesCronField(expression: string, value: number, options: CronFieldOptions): boolean {
    return expression.split(',').some(segment => matchesCronSegment(segment.trim(), value, options));
}

function validateCronField(expression: string, options: CronFieldOptions): void {
    for (const segment of expression.split(',')) {
        validateCronSegment(segment.trim(), options);
    }
}

function matchesCronSegment(segment: string, value: number, options: CronFieldOptions): boolean {
    if (!segment) throw new Error('empty cron segment');

    let base = segment;
    let step = 1;
    if (segment.includes('/')) {
        const [rawBase, rawStep, ...rest] = segment.split('/');
        if (!rawBase || !rawStep || rest.length > 0) {
            throw new Error(`invalid cron step segment "${segment}"`);
        }
        base = rawBase;
        step = parsePositiveInteger(rawStep, `invalid cron step "${rawStep}"`);
    }

    if (base === '*') {
        return withinRange(value, options.min, options.max) && (value - options.min) % step === 0;
    }

    if (base.includes('-')) {
        const [startRaw, endRaw, ...rest] = base.split('-');
        if (!startRaw || !endRaw || rest.length > 0) {
            throw new Error(`invalid cron range "${base}"`);
        }
        const start = parseFieldValue(startRaw, options);
        const end = parseFieldValue(endRaw, options);
        if (start > end) throw new Error(`invalid cron range "${base}"`);
        return value >= start && value <= end && (value - start) % step === 0;
    }

    const start = parseFieldValue(base, options);
    if (step === 1) return value === start;
    return value >= start && value <= options.max && (value - start) % step === 0;
}

function validateCronSegment(segment: string, options: CronFieldOptions): void {
    if (!segment) throw new Error('empty cron segment');

    let base = segment;
    if (segment.includes('/')) {
        const [rawBase, rawStep, ...rest] = segment.split('/');
        if (!rawBase || !rawStep || rest.length > 0) {
            throw new Error(`invalid cron step segment "${segment}"`);
        }
        base = rawBase;
        parsePositiveInteger(rawStep, `invalid cron step "${rawStep}"`);
    }

    if (base === '*') return;

    if (base.includes('-')) {
        const [startRaw, endRaw, ...rest] = base.split('-');
        if (!startRaw || !endRaw || rest.length > 0) {
            throw new Error(`invalid cron range "${base}"`);
        }
        const start = parseFieldValue(startRaw, options);
        const end = parseFieldValue(endRaw, options);
        if (start > end) throw new Error(`invalid cron range "${base}"`);
        return;
    }

    parseFieldValue(base, options);
}

function parseFieldValue(token: string, options: CronFieldOptions): number {
    const raw = token.trim().toLowerCase();
    const aliasValue = options.aliases?.[raw];
    const parsed = aliasValue != null ? aliasValue : Number(raw);
    if (!Number.isInteger(parsed)) {
        throw new Error(`invalid cron value "${token}"`);
    }
    const normalized = options.normalize ? options.normalize(parsed) : parsed;
    if (!withinRange(normalized, options.min, options.max)) {
        throw new Error(`cron value "${token}" out of range ${options.min}-${options.max}`);
    }
    return normalized;
}

function parsePositiveInteger(raw: string, message: string): number {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(message);
    return parsed;
}

function normalizeWeekday(value: number): number {
    return value === 7 ? 0 : value;
}

function withinRange(value: number, min: number, max: number): boolean {
    return value >= min && value <= max;
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}
